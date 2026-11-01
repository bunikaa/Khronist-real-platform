import { hasKeyFor, type Config } from '../../config.ts'
import { createAnthropicMessages, createAnthropicProvider } from './anthropic.ts'
import { createGeminiInteractions, createGeminiProvider } from './gemini.ts'
import type { LlmProvider } from './index.ts'

type ProviderSettings = {
  model: string
  effort: Config['HTR_EFFORT']
  geminiNotes?: string | undefined
}

export type ProviderFactory = (
  config: Config,
  settings: ProviderSettings,
) => LlmProvider | undefined

export const createProvider: ProviderFactory = (config, { model, effort, geminiNotes }) => {
  if (!hasKeyFor(config, model)) return undefined
  if (model.startsWith('gemini-')) {
    return createGeminiProvider({
      interactions: createGeminiInteractions(config.GOOGLE_API_KEY ?? ''),
      model,
      thinkingLevel: 'low',
      notes: geminiNotes,
    })
  }
  return createAnthropicProvider({
    messages: createAnthropicMessages(config.ANTHROPIC_API_KEY ?? ''),
    model,
    effort,
  })
}
