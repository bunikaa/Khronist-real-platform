import type { Line, RecognitionEvent, Transcription } from '@khronist/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiFailure, maxReconnects, readRecognition, reconnectDelayMs } from '../api/client.ts'
import { parseEventBlock, readEvents } from '../api/events.ts'

const line: Line = {
  idx: 0,
  text: 'Села Борщаговки',
  box: { x: 0, y: 0, w: 1, h: 1 },
  boxSource: 'estimated',
  uncertain: false,
  words: [],
}

const transcription: Transcription = {
  id: '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11',
  regionId: '8a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
  box: { x: 0, y: 0, w: 1, h: 1 },
  version: 1,
  status: 'draft',
  lines: [line],
  normalizedText: 'Села Борщагівки',
  entities: [],
  reader: 'claude-sonnet-5-5',
  createdAt: '2026-11-14T12:00:00.000Z',
}

const recognitionId = '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c'

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })

const collect = async (stream: ReadableStream<Uint8Array>) => {
  const events: RecognitionEvent[] = []
  for await (const event of readEvents(stream)) events.push(event)
  return events
}

describe('parseEventBlock', () => {
  it('reads a named event with JSON data', () => {
    expect(parseEventBlock('event: progress\ndata: {"status":"reading"}')).toEqual({
      event: 'progress',
      data: { status: 'reading' },
    })
  })

  it('skips pings, retry hints, broken JSON and events outside the contract', () => {
    expect(parseEventBlock(': ping')).toBeNull()
    expect(parseEventBlock('retry: 3000')).toBeNull()
    expect(parseEventBlock('event: line\ndata: {oops')).toBeNull()
    expect(parseEventBlock('event: progress\ndata: {"status":"sleeping"}')).toBeNull()
  })
})

describe('readEvents', () => {
  it('joins events split across chunks and CRLF line breaks', async () => {
    const events = await collect(
      streamOf(
        'retry: 3000\n\nevent: progress\r\ndata: {"status":',
        '"reading"}\r\n\r\n: ping\n\nevent: line\ndata: ',
        `${JSON.stringify({ line })}\n\n`,
      ),
    )

    expect(events).toEqual([
      { event: 'progress', data: { status: 'reading' } },
      { event: 'line', data: { line } },
    ])
  })
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const request = {
  image: { base64Png: 'iVBORw0KGgo=' },
  imageHash: 'a'.repeat(64),
  source: 'extension' as const,
}

describe('readRecognition', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns a cached transcription without opening the event stream', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({ recognitionId, status: 'cached', transcriptionId: transcription.id }, 201),
      )
      .mockResolvedValueOnce(json({ recognitionId, status: 'done', transcription }))
    vi.stubGlobal('fetch', fetch)

    const state = await readRecognition(request, new AbortController().signal, () => undefined)

    expect(state.transcription).toEqual(transcription)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.khronist.org/v1/recognitions')
  })

  it('follows the event stream until the recognition finishes', async () => {
    const events: RecognitionEvent[] = []
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ recognitionId, status: 'queued' }, 201))
        .mockResolvedValueOnce(json({ recognitionId, status: 'queued' }))
        .mockResolvedValueOnce(
          new Response(
            streamOf(
              'event: progress\ndata: {"status":"reading"}\n\n',
              `event: line\ndata: ${JSON.stringify({ line })}\n\n`,
              `event: done\ndata: {"transcriptionId":"${transcription.id}"}\n\n`,
            ),
          ),
        )
        .mockResolvedValueOnce(json({ recognitionId, status: 'done', transcription })),
    )

    const state = await readRecognition(request, new AbortController().signal, (event) =>
      events.push(event),
    )

    expect(events.map((event) => event.event)).toEqual(['progress', 'line', 'done'])
    expect(state.status).toBe('done')
  })

  it('stops when the stream ends with a failure even if the state still says reading', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ recognitionId, status: 'queued' }, 201))
      .mockResolvedValueOnce(json({ recognitionId, status: 'reading' }))
      .mockResolvedValueOnce(
        new Response(
          streamOf('event: failed\ndata: {"code":"restarted","message":"Перезапущено"}\n\n'),
        ),
      )
      .mockResolvedValue(json({ recognitionId, status: 'reading' }))
    vi.stubGlobal('fetch', fetch)

    const state = await readRecognition(request, new AbortController().signal, () => undefined)

    expect(state).toEqual({
      recognitionId,
      status: 'failed',
      error: { code: 'restarted', message: 'Перезапущено' },
    })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('waits between reconnects and gives up after a limited number of them', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/events')
        ? new Response(streamOf(': ping\n\n'))
        : url.endsWith('/v1/recognitions')
          ? json({ recognitionId, status: 'queued' }, 201)
          : json({ recognitionId, status: 'reading' }),
    )
    vi.stubGlobal('fetch', fetch)

    const settled = readRecognition(request, new AbortController().signal, () => undefined).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(reconnectDelayMs - 1)
    const streams = () => fetch.mock.calls.filter(([url]) => url.endsWith('/events')).length
    expect(streams()).toBe(1)
    await vi.advanceTimersByTimeAsync(reconnectDelayMs * (maxReconnects + 1))

    expect(await settled).toMatchObject({ code: 'stalled' })
    expect(streams()).toBe(maxReconnects + 1)
  })

  it('turns an API error into ApiFailure with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        json(
          {
            error: {
              code: 'too_many_requests',
              message: 'Денний ліміт розпізнавань вичерпано, спробуйте завтра',
            },
          },
          429,
        ),
      ),
    )

    const failure = readRecognition(request, new AbortController().signal, () => undefined)

    await expect(failure).rejects.toBeInstanceOf(ApiFailure)
    await expect(failure).rejects.toMatchObject({
      code: 'too_many_requests',
      message: 'Денний ліміт розпізнавань вичерпано, спробуйте завтра',
    })
  })
})
