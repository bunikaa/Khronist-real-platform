import type { RecognitionEvent } from '@khronist/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createEventHub } from '../src/jobs/events.ts'

const progress: RecognitionEvent = { event: 'progress', data: { status: 'reading' } }
const done: RecognitionEvent = {
  event: 'done',
  data: { transcriptionId: '019254c0-0000-7000-8000-000000000001' },
}

describe('event hub', () => {
  it('replays history to a late subscriber and then delivers live events', () => {
    const hub = createEventHub()
    hub.publish('a', progress)
    const received: RecognitionEvent[] = []
    hub.subscribe('a', (event) => received.push(event))
    hub.publish('a', done)
    expect(received).toEqual([progress, done])
  })

  it('keeps recognitions separate', () => {
    const hub = createEventHub()
    const received: RecognitionEvent[] = []
    hub.subscribe('a', (event) => received.push(event))
    hub.publish('b', progress)
    expect(received).toEqual([])
  })

  it('stops delivering after unsubscribe', () => {
    const hub = createEventHub()
    const received: RecognitionEvent[] = []
    const stop = hub.subscribe('a', (event) => received.push(event))
    stop()
    hub.publish('a', progress)
    expect(received).toEqual([])
  })

  it('survives a throwing listener and drops it', () => {
    const hub = createEventHub()
    const good: RecognitionEvent[] = []
    hub.subscribe('a', () => {
      throw new Error('socket closed')
    })
    hub.subscribe('a', (event) => good.push(event))
    hub.publish('a', progress)
    hub.publish('a', done)
    expect(good).toEqual([progress, done])
  })

  it('forgets a finished recognition after the retention period', () => {
    vi.useFakeTimers()
    try {
      const hub = createEventHub(1000)
      hub.publish('a', progress)
      hub.publish('a', done)
      expect(hub.hasHistory('a')).toBe(true)
      vi.advanceTimersByTime(1001)
      expect(hub.hasHistory('a')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not keep an empty channel after the only subscriber leaves', () => {
    const hub = createEventHub()
    const stop = hub.subscribe('a', () => {})
    stop()
    expect(hub.hasHistory('a')).toBe(false)
  })
})
