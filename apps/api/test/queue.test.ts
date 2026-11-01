import { describe, expect, it } from 'vitest'
import { createJobQueue } from '../src/jobs/queue.ts'

describe('job queue', () => {
  it('finishes the running job and starts no waiting ones after stop', async () => {
    const queue = createJobQueue(1, () => {})
    const started: string[] = []
    let finish: () => void = () => {}
    queue.add(async () => {
      started.push('running')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    queue.add(async () => {
      started.push('waiting')
    })

    queue.stop()
    finish()
    await queue.onIdle()

    expect(started).toEqual(['running'])
  })
})
