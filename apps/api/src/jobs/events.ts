import type { RecognitionEvent } from '@khronist/contracts'

type EventListener = (event: RecognitionEvent) => void

export type EventHub = {
  publish: (recognitionId: string, event: RecognitionEvent) => void
  subscribe: (recognitionId: string, listener: EventListener) => () => void
  hasHistory: (recognitionId: string) => boolean
}

type Channel = {
  events: RecognitionEvent[]
  listeners: Set<EventListener>
  cleanup?: NodeJS.Timeout
}

export const createEventHub = (retainMs = 60_000): EventHub => {
  const channels = new Map<string, Channel>()

  const channelFor = (id: string): Channel => {
    const existing = channels.get(id)
    if (existing) return existing
    const created: Channel = { events: [], listeners: new Set() }
    channels.set(id, created)
    return created
  }

  return {
    publish: (id, event) => {
      const channel = channelFor(id)
      channel.events.push(event)
      for (const listener of [...channel.listeners]) {
        try {
          listener(event)
        } catch {
          channel.listeners.delete(listener)
        }
      }
      if (event.event === 'done' || event.event === 'failed') {
        clearTimeout(channel.cleanup)
        channel.cleanup = setTimeout(() => channels.delete(id), retainMs)
        channel.cleanup.unref()
      }
    },
    subscribe: (id, listener) => {
      const channel = channelFor(id)
      channel.listeners.add(listener)
      for (const event of [...channel.events]) listener(event)
      return () => {
        channel.listeners.delete(listener)
        if (channel.listeners.size === 0 && channel.events.length === 0) channels.delete(id)
      }
    },
    hasHistory: (id) => (channels.get(id)?.events.length ?? 0) > 0,
  }
}
