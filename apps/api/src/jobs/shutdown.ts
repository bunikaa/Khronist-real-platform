import type { Database } from '../db/client.ts'
import type { EventHub } from './events.ts'
import type { JobQueue } from './queue.ts'
import { failRecognitions, failureEvent } from './recognize.ts'

type ShutdownDeps = { db: Database; hub: EventHub; queue: JobQueue; drainMs: number }

export const closeOwnRecognitions = async ({ db, hub, queue, drainMs }: ShutdownDeps) => {
  const close = async (ids: string[]) => {
    const closed = await failRecognitions(db, ids, 'restarted')
    for (const id of closed) hub.publish(id, failureEvent('restarted'))
    return closed.length
  }
  const dropped = await close(queue.stop())
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    queue.onIdle(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, drainMs)
    }),
  ])
  clearTimeout(timer)
  const unfinished = queue.running()
  queue.abort(unfinished)
  const cut = await close(unfinished)
  return { dropped, cut }
}
