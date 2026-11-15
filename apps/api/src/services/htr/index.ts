import type { HealthResponse, Hints, Line, ReadingWarning } from '@khronist/contracts'
import { loadProviderNotes } from '@khronist/prompts'
import type { Config } from '../../config.ts'
import { readPrimaryLimitMs } from '../../lib/limits.ts'
import { withCallBudget, withFallback, type CallBudget, type LlmLog } from '../llm/index.ts'
import { createProvider, type ProviderFactory } from '../llm/select.ts'
import { createFixtureReader } from './fixture.ts'
import { createVisionReader } from './vision.ts'

export type ReadLog = LlmLog & { info: (details: object, message: string) => void }

export type ReadInput = {
  image: Buffer
  hints?: Hints | undefined
  signal?: AbortSignal | undefined
  log?: ReadLog | undefined
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
  const provider = (model: string) => {
    const made = makeProvider(config, {
      model,
      effort: config.HTR_EFFORT,
      geminiNotes: loadProviderNotes('htr_vision', 'gemini'),
    })
    return made && withCallBudget(made, budget)
  }
  const primary = provider(config.HTR_MODEL_PRIMARY)
  const fallback = config.HTR_MODEL_FALLBACK ? provider(config.HTR_MODEL_FALLBACK) : undefined
  const first = primary ?? fallback
  if (!first) return undefined
  return createVisionReader(withFallback(first, primary ? fallback : undefined, readPrimaryLimitMs))
}
