import {
  createRecognitionResponseSchema,
  healthResponseSchema,
  recognitionStateSchema,
  searchResponseSchema,
} from '@khronist/contracts'
import { createHash, randomUUID } from 'node:crypto'

const baseUrl = process.env['SMOKE_URL'] ?? 'http://localhost:3000'
const pollIntervalMs = 100
const pollLimit = 100

const makePng = (): Buffer => {
  const header = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(1 + Math.floor(Math.random() * 7000), 16)
  header.writeUInt32BE(1 + Math.floor(Math.random() * 7000), 20)
  const end = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  return Buffer.concat([header, end])
}

const expectThat = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`smoke check failed: ${message}`)
}

const health = healthResponseSchema.parse(await (await fetch(`${baseUrl}/health`)).json())
expectThat(health.ok && health.db === 'ok', 'the database answers')

const png = makePng()
const shelfmark = { archive: `smoke-${randomUUID()}`, fond: '1', opys: '1', sprava: '1', image: 1 }
const post = async () => {
  const response = await fetch(`${baseUrl}/v1/recognitions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      image: { base64Png: png.toString('base64') },
      imageHash: createHash('sha256').update(png).digest('hex'),
      source: 'batch',
      shelfmark,
    }),
  })
  expectThat(response.status === 201, `POST answered ${response.status}`)
  return createRecognitionResponseSchema.parse(await response.json())
}

const readState = async (id: string) =>
  recognitionStateSchema.parse(await (await fetch(`${baseUrl}/v1/recognitions/${id}`)).json())

const created = await post()
let state = await readState(created.recognitionId)
for (
  let attempt = 0;
  attempt < pollLimit && state.status !== 'done' && state.status !== 'failed';
  attempt += 1
) {
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  state = await readState(created.recognitionId)
}
expectThat(state.status === 'done', `the reading ended as ${state.status}`)
expectThat((state.transcription?.lines.length ?? 0) > 0, 'the transcription has lines')

const repeated = await post()
expectThat(repeated.status === 'cached', 'a repeated fragment comes from the cache')

const events = await (
  await fetch(`${baseUrl}/v1/recognitions/${repeated.recognitionId}/events`)
).text()
expectThat(events.includes('event: done'), 'the event stream ends with done')

const searchParams = new URLSearchParams({ q: 'Коваленко', archive: shelfmark.archive })
const found = searchResponseSchema.parse(
  await (await fetch(`${baseUrl}/v1/search?${searchParams.toString()}`)).json(),
)
expectThat(
  found.items.some((item) => item.transcriptionId === state.transcription?.id),
  'search finds the new transcription by a word of its text',
)

console.log('smoke checks passed')
