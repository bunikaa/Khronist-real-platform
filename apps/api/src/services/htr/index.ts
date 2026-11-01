import type { Hints, Line } from '@khronist/contracts'
import { loadProviderNotes } from '@khronist/prompts'
import type { Config } from '../../config.ts'
import { createAnthropicMessages, createAnthropicProvider } from '../llm/anthropic.ts'
import { createGeminiInteractions, createGeminiProvider, type GeminiThinkingLevel } from '../llm/gemini.ts'
import { withFallback, type LlmFailureLog, type LlmProvider } from '../llm/index.ts'
import { createFixtureReader } from './fixture.ts'
import { createVisionReader, type VisionReadLog } from './vision.ts'

const geminiThinkingLevel: GeminiThinkingLevel = 'low'

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

const createProvider = (config: Config, model: string): LlmProvider | undefined => {
  if (model.startsWith('gemini-')) {
    if (config.GOOGLE_API_KEY === undefined) return undefined
    return createGeminiProvider({
      interactions: createGeminiInteractions(config.GOOGLE_API_KEY),
      model,
      thinkingLevel: geminiThinkingLevel,
      notes: loadProviderNotes('htr_vision', 'gemini'),
    })
  }
  if (config.ANTHROPIC_API_KEY === undefined) return undefined
  return createAnthropicProvider({
    messages: createAnthropicMessages(config.ANTHROPIC_API_KEY),
    model,
    effort: config.HTR_EFFORT,
  })
}

export const selectHtrReader = (config: Config, logs: HtrLogs): HtrReader | undefined => {
  if (config.LLM_FIXTURES) return createFixtureReader()
  const primary = createProvider(config, config.HTR_MODEL_PRIMARY)
  const fallback = config.HTR_MODEL_FALLBACK ? createProvider(config, config.HTR_MODEL_FALLBACK) : undefined
  const first = primary ?? fallback
  if (!first) return undefined
  return createVisionReader(withFallback(first, primary ? fallback : undefined, logs.onFailure), logs.onRead)
}
