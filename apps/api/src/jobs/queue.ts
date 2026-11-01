import PQueue from 'p-queue'

export type JobQueue = {
  reserve: (limit: number) => boolean
  release: () => void
  add: (job: () => Promise<void>) => void
  onIdle: () => Promise<void>
  backlog: () => number
  stop: () => void
}

export const createJobQueue = (
  concurrency: number,
  onError: (error: unknown) => void,
): JobQueue => {
  const queue = new PQueue({ concurrency })
  let held = 0
  const release = () => {
    held = Math.max(0, held - 1)
  }
  return {
    reserve: (limit) => {
      if (held >= limit) return false
      held += 1
      return true
    },
    release,
    add: (job) => {
      queue
        .add(async () => {
          try {
            await job()
          } finally {
            release()
          }
        })
        .catch(onError)
    },
    onIdle: () => queue.onIdle(),
    backlog: () => held,
    stop: () => {
      queue.pause()
      queue.clear()
    },
  }
}
