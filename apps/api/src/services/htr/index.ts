import type { HealthResponse, Hints, Line } from '@khronist/contracts'
import { loadProviderNotes } from '@khronist/prompts'
import type { Config } from '../../config.ts'
import { withFallback, type LlmFailureLog } from '../llm/index.ts'
import { createProvider, type ProviderFactory } from '../llm/select.ts'
import { createFixtureReader } from './fixture.ts'
import { createVisionReader, type VisionReadLog } from './vision.ts'

export type ReadInput = {
  image: Buffer
  hints?: Hints | undefined
  signal?: AbortSignal | undefined
}

export type ReadResult = {
  lines: Line[]
  reader: string
}

export type HtrReader = {
  kind: Exclude<HealthResponse['htr'], 'down'>
  read: (input: ReadInput) => Promise<ReadResult>
}

type HtrLogs = {
  onRead: (details: VisionReadLog) => void
  onFailure: LlmFailureLog
}

export const selectHtrReader = (
  config: Config,
  logs: HtrLogs,
  makeProvider: ProviderFactory = createProvider,
): HtrReader | undefined => {
  if (config.LLM_FIXTURES) return createFixtureReader()
  const provider = (model: string) =>
    makeProvider(config, {
      model,
      effort: config.HTR_EFFORT,
      geminiNotes: loadProviderNotes('htr_vision', 'gemini'),
    })
  const primary = provider(config.HTR_MODEL_PRIMARY)
  const fallback = config.HTR_MODEL_FALLBACK ? provider(config.HTR_MODEL_FALLBACK) : undefined
  const first = primary ?? fallback
  if (!first) return undefined
  return createVisionReader(withFallback(first, primary ? fallback : undefined, logs.onFailure), logs.onRead)
}
