import { hasKeyFor, type Config, type ModelEffort } from '../../config.ts'
import { createAnthropicMessages, createAnthropicProvider } from './anthropic.ts'
import { createGeminiInteractions, createGeminiProvider } from './gemini.ts'
import { withCallBudget, withFallback, type CallBudget, type LlmProvider } from './index.ts'

type ProviderSettings = {
  model: string
  effort: ModelEffort
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

type ProviderChoice = {
  primary: string
  fallback?: string | undefined
  effort: ModelEffort
  primaryLimitMs: number
  geminiNotes?: string | undefined
}

export const selectProvider = (
  config: Config,
  budget: CallBudget,
  choice: ProviderChoice,
  makeProvider: ProviderFactory = createProvider,
): LlmProvider | undefined => {
  const provider = (model: string) => {
    const made = makeProvider(config, {
      model,
      effort: choice.effort,
      geminiNotes: choice.geminiNotes,
    })
    return made && withCallBudget(made, budget)
  }
  const primary = provider(choice.primary)
  const fallback = choice.fallback ? provider(choice.fallback) : undefined
  const first = primary ?? fallback
  if (!first) return undefined
  return withFallback(first, primary ? fallback : undefined, choice.primaryLimitMs)
}
