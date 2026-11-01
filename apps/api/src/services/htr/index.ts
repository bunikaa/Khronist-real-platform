import type { Hints, Line } from '@khronist/contracts'
import type { Config } from '../../config.ts'
import { createAnthropicMessages, createAnthropicProvider } from '../llm/anthropic.ts'
import { withFallback, type LlmFailureLog } from '../llm/index.ts'
import { createFixtureReader } from './fixture.ts'
import { createVisionReader, type VisionReadLog } from './vision.ts'

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

export type HtrLogs = {
  onRead: (details: VisionReadLog) => void
  onFailure: LlmFailureLog
}

export const selectHtrReader = (config: Config, logs: HtrLogs): HtrReader | undefined => {
  if (config.LLM_FIXTURES) return createFixtureReader()
  if (config.ANTHROPIC_API_KEY === undefined) return undefined
  const messages = createAnthropicMessages(config.ANTHROPIC_API_KEY)
  const provider = (model: string) =>
    createAnthropicProvider({ messages, model, effort: config.HTR_EFFORT })
  const fallback = config.HTR_MODEL_FALLBACK ? provider(config.HTR_MODEL_FALLBACK) : undefined
  return createVisionReader(
    withFallback(provider(config.HTR_MODEL_PRIMARY), fallback, logs.onFailure),
    logs.onRead,
  )
}
