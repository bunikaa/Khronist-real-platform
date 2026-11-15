import PQueue from 'p-queue'

export type Slot = {
  run: (recognitionId: string, job: (signal: AbortSignal) => Promise<void>) => void
  release: () => void
}

type SlotLimits = { total: number; perOwner: number }

export type JobQueue = {
  reserve: (owner: string, limits: SlotLimits) => Slot | 'full' | 'busy' | 'stopped'
  onIdle: () => Promise<void>
  backlog: () => number
  running: () => string[]
  abort: (recognitionIds: string[]) => void
  stop: () => string[]
}

export const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

export const createJobQueue = (
  concurrency: number,
  onError: (error: unknown) => void,
): JobQueue => {
  const queue = new PQueue({ concurrency })
  const owners = new Map<string, number>()
  const waiting = new Map<string, () => void>()
  const started = new Map<string, AbortController>()
  let held = 0
  let stopped = false

  return {
    reserve: (owner, limits) => {
      if (stopped) return 'stopped'
      const ownerHeld = owners.get(owner) ?? 0
      if (held >= limits.total) return 'full'
      if (ownerHeld >= limits.perOwner) return 'busy'
      held += 1
      owners.set(owner, ownerHeld + 1)
      let released = false
      const release = () => {
        if (released) return
        released = true
        held -= 1
        const left = (owners.get(owner) ?? 1) - 1
        if (left > 0) owners.set(owner, left)
        else owners.delete(owner)
      }
      return {
        release,
        run: (recognitionId, job) => {
          waiting.set(recognitionId, release)
          queue
            .add(async () => {
              waiting.delete(recognitionId)
              const controller = new AbortController()
              started.set(recognitionId, controller)
              try {
                await job(controller.signal)
              } finally {
                started.delete(recognitionId)
                release()
              }
            })
            .catch((error: unknown) => {
              if (!isAbort(error)) onError(error)
            })
        },
      }
    },
    onIdle: () => queue.onIdle(),
    backlog: () => held,
    running: () => [...started.keys()],
    abort: (recognitionIds) => {
      for (const id of recognitionIds) {
        started.get(id)?.abort(new Error('the server is shutting down'))
      }
    },
    stop: () => {
      stopped = true
      queue.pause()
      queue.clear()
      const dropped = [...waiting.keys()]
      for (const release of waiting.values()) release()
      waiting.clear()
      return dropped
    },
  }
}
