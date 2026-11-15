import { describe, expect, it } from 'vitest'
import { createJobQueue, type JobQueue, type Slot } from '../src/jobs/queue.ts'

const limits = { total: 10, perOwner: 2 }

const slotOf = (reserved: ReturnType<JobQueue['reserve']>): Slot => {
  if (typeof reserved === 'string') throw new Error(`no slot: ${reserved}`)
  return reserved
}

describe('job queue', () => {
  it('finishes the running job, starts no waiting ones after stop and names them', async () => {
    const errors: unknown[] = []
    const queue = createJobQueue(1, (error) => errors.push(error))
    const started: string[] = []
    let finish: () => void = () => {}
    slotOf(queue.reserve('a', limits)).run('running', async () => {
      started.push('running')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    slotOf(queue.reserve('b', limits)).run('waiting', async () => {
      started.push('waiting')
    })
    await Promise.resolve()

    expect(queue.running()).toEqual(['running'])
    expect(queue.stop()).toEqual(['waiting'])
    finish()
    await queue.onIdle()

    expect(started).toEqual(['running'])
    expect(queue.backlog()).toBe(0)
    expect(queue.running()).toEqual([])
    expect(errors).toEqual([])
  })

  it('gives no slot after stop, so a late request cannot leave a job that never runs', () => {
    const queue = createJobQueue(1, () => {})
    queue.stop()
    expect(queue.reserve('a', limits)).toBe('stopped')
  })

  it('aborts the jobs it is told to cut', async () => {
    const queue = createJobQueue(1, () => {})
    let seen: AbortSignal | undefined
    slotOf(queue.reserve('a', limits)).run('cut', async (signal) => {
      seen = signal
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    })
    await Promise.resolve()
    queue.abort(queue.running())
    await queue.onIdle()
    expect(seen?.aborted).toBe(true)
  })

  it('limits slots per owner and in total, and frees them on release', () => {
    const queue = createJobQueue(1, () => {})
    const first = slotOf(queue.reserve('a', limits))
    slotOf(queue.reserve('a', limits))
    expect(queue.reserve('a', limits)).toBe('busy')
    expect(queue.reserve('b', { total: 2, perOwner: 2 })).toBe('full')
    first.release()
    first.release()
    expect(typeof queue.reserve('a', limits)).toBe('object')
    expect(queue.backlog()).toBe(2)
  })
})
