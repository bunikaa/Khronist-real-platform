import type { HealthResponse, Hints, Line, ReadingWarning } from '@khronist/contracts'
import { loadProviderNotes } from '@khronist/prompts'
import type { Config } from '../../config.ts'
import { readPrimaryLimitMs } from '../../lib/limits.ts'
import type { CallBudget, LlmCallLog } from '../llm/index.ts'
import { createProvider, selectProvider, type ProviderFactory } from '../llm/select.ts'
import { createFixtureReader } from './fixture.ts'
import { createVisionReader } from './vision.ts'

export type ReadInput = {
  image: Buffer
  hints?: Hints | undefined
  signal?: AbortSignal | undefined
  log?: LlmCallLog | undefined
}

export type ReadResult = {
  lines: Line[]
  warnings: ReadingWarning[]
  reader: string
}

export type HtrReader = {
  kind: Exclude<HealthResponse['htr'], 'down'>
  read: (input: ReadInput) => Promise<ReadResult>
}

export const selectHtrReader = (
  config: Config,
  budget: CallBudget,
  makeProvider: ProviderFactory = createProvider,
): HtrReader | undefined => {
  if (config.LLM_FIXTURES) return createFixtureReader()
  const llm = selectProvider(
    config,
    budget,
    {
      primary: config.HTR_MODEL_PRIMARY,
      fallback: config.HTR_MODEL_FALLBACK,
      effort: config.HTR_EFFORT,
      primaryLimitMs: readPrimaryLimitMs,
      geminiNotes: loadProviderNotes('htr_vision', 'gemini'),
    },
    makeProvider,
  )
  return llm && createVisionReader(llm)
}
