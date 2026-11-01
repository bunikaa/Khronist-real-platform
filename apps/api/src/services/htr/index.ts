import type { Hints, Line } from '@khronist/contracts'
import type { Config } from '../../config.ts'
import { createFixtureReader } from './fixture.ts'

export type ReadInput = {
  image: Buffer
  hints?: Hints | undefined
  signal?: AbortSignal | undefined
}

export type HtrReader = {
  kind: 'fixture' | 'vision' | 'remote'
  name: string
  read: (input: ReadInput) => Promise<Line[]>
}

export const selectHtrReader = (config: Config): HtrReader | undefined => {
  if (config.LLM_FIXTURES) return createFixtureReader()
  return undefined
}
