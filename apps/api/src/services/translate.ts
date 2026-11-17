import {
  lineTextSchema,
  translateOutputSchema,
  type Hints,
  type TranslateOutput,
} from '@khronist/contracts'
import { loadPrompt, renderPrompt } from '@khronist/prompts'
import type { Config } from '../config.ts'
import { translatePrimaryLimitMs } from '../lib/limits.ts'
import { hiddenCharacters } from '../lib/text.ts'
import { hintValues, isRussianOrUnmarked } from './hints.ts'
import type { CallBudget, LlmCallLog, LlmProvider } from './llm/index.ts'
import { createProvider, selectProvider, type ProviderFactory } from './llm/select.ts'

type TranslateInput = {
  lines: string[]
  hints?: Hints | undefined
  signal?: AbortSignal | undefined
  log?: LlmCallLog | undefined
}

export type Translator = {
  translate: (input: TranslateInput) => Promise<TranslateOutput | null>
}

export const noTranslation: Translator = { translate: async () => null }

const isBlank = (line: string) => /^[\s\p{Cf}]*$/u.test(line)

const unreadMarks = (line: string) => line.split('[нрзб]').length - 1

const latinLetters = /[a-z]/i

const lineProblem = (line: string, source: string): string | undefined => {
  const text = lineTextSchema.safeParse(line)
  if (!text.success) return text.error.issues[0]?.message ?? 'is not a valid line'
  if (
    [...line].some((character) => hiddenCharacters.test(character) && !source.includes(character))
  ) {
    return 'holds a hidden character that is not in the source'
  }
  if (isBlank(line) !== isBlank(source)) {
    return 'is blank where the source is not, or the other way round'
  }
  if (unreadMarks(line) !== unreadMarks(source)) return 'changes the unread marks'
  if (latinLetters.test(line) && !latinLetters.test(source)) return 'holds Latin letters'
  return undefined
}

export const translationProblem = (
  lines: string[],
  output: TranslateOutput,
): string | undefined => {
  if (output.lines.length !== lines.length) {
    return `translation returned ${output.lines.length} of ${lines.length} lines`
  }
  for (const [index, line] of output.lines.entries()) {
    const problem = lineProblem(line, lines[index] ?? '')
    if (problem) return `translated line ${index}: ${problem}`
  }
  return undefined
}

const maxOutputTokens = 8192

export const createLlmTranslator = (llm: LlmProvider): Translator => {
  const prompt = loadPrompt('translate')
  return {
    translate: async ({ lines, hints, signal, log }) => {
      if (!isRussianOrUnmarked(hints) || lines.every(isBlank)) return null
      const schema = translateOutputSchema.superRefine((output, context) => {
        const problem = translationProblem(lines, output)
        if (problem) context.addIssue({ code: 'custom', message: problem })
      })
      const startedAt = Date.now()
      const { value, model, usage } = await llm.complete({
        system: prompt.system,
        content: [
          {
            type: 'text',
            text: renderPrompt(prompt.user, { ...hintValues(hints), lines: JSON.stringify(lines) }),
          },
        ],
        schema,
        maxTokens: maxOutputTokens,
        signal,
        log,
      })
      log?.info({ model, usage, durationMs: Date.now() - startedAt }, 'lines translated')
      return value
    },
  }
}

export const selectTranslator = (
  config: Config,
  budget: CallBudget,
  makeProvider: ProviderFactory = createProvider,
): Translator => {
  if (config.LLM_FIXTURES) return noTranslation
  const llm = selectProvider(
    config,
    budget,
    {
      primary: config.LLM_MODEL_PRIMARY,
      fallback: config.LLM_MODEL_FALLBACK,
      effort: config.LLM_EFFORT,
      primaryLimitMs: translatePrimaryLimitMs,
    },
    makeProvider,
  )
  return llm ? createLlmTranslator(llm) : noTranslation
}
