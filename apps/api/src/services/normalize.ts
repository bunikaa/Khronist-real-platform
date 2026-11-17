import {
  normalizeOutputSchema,
  storableText,
  type Hints,
  type Line,
  type NormalizeOutput,
} from '@khronist/contracts'
import { loadPrompt, renderPrompt } from '@khronist/prompts'
import type { Config } from '../config.ts'
import { normalizePrimaryLimitMs } from '../lib/limits.ts'
import { hintValues, isRussianOrUnmarked } from './hints.ts'
import type { CallBudget, LlmCallLog, LlmProvider } from './llm/index.ts'
import { createProvider, selectProvider, type ProviderFactory } from './llm/select.ts'

type NormalizeInput = {
  lines: Line[]
  hints?: Hints | undefined
  signal?: AbortSignal | undefined
  log?: LlmCallLog | undefined
}

export type Normalizer = {
  normalize: (input: NormalizeInput) => Promise<NormalizeOutput | null>
}

export const passthroughNormalizer: Normalizer = { normalize: async () => null }

const letterRules: [RegExp, string][] = [
  [/ѣ/g, 'е'],
  [/ѳ/g, 'ф'],
  [/[іѵ]/g, 'и'],
  [/ё/g, 'е'],
  [/з/g, 'с'],
  [/ъ(?=-)/g, ''],
]

const endingRules: [RegExp, string][] = [
  [/ъ$/, ''],
  [/(аго|яго|ого|его)$/, 'ого'],
  [/(ыя|ые)$/, 'ые'],
  [/(ия|ие)$/, 'ие'],
  [/(ея|ее)$/, 'ее'],
]

const pronounForms: Record<string, string> = {
  оне: 'они',
  одне: 'одни',
  однех: 'одних',
  однем: 'одним',
  однеми: 'одними',
}

const wordParts = /^(\P{L}*)(.*?)(\P{L}*)$/u

export const spellingKey = (word: string): string => {
  const [, before = '', core = '', after = ''] = wordParts.exec(word.toLowerCase()) ?? []
  let folded = core
  for (const [pattern, replacement] of letterRules) folded = folded.replace(pattern, replacement)
  for (const [pattern, replacement] of endingRules) folded = folded.replace(pattern, replacement)
  return before + (pronounForms[folded] ?? folded) + after
}

const lineProblem = (
  index: number,
  read: Line,
  line: NormalizeOutput['lines'][number],
  expanded: Set<string>,
): string | undefined => {
  if (line.words.map((word) => word.text).join(' ') !== line.text) {
    return `the words of normalized line ${index} do not add up to its text`
  }
  if (line.words.length !== read.words.length) {
    return `normalized line ${index} has ${line.words.length} of ${read.words.length} words`
  }
  for (const [at, word] of line.words.entries()) {
    const source = read.words[at]
    if (!source) continue
    if (word.text === '' || /\s/.test(word.text)) {
      return `normalized word ${index}:${at} is empty or holds a space`
    }
    if (source.uncertain && !word.uncertain) {
      return `normalized line ${index} lost an uncertain word`
    }
    if (!expanded.has(`${index}:${at}`) && spellingKey(source.text) !== spellingKey(word.text)) {
      return `normalized word ${index}:${at} changes more than the spelling`
    }
  }
  return undefined
}

export const normalizationProblem = (
  lines: Line[],
  output: NormalizeOutput,
): string | undefined => {
  if (output.lines.length !== lines.length) {
    return `normalization returned ${output.lines.length} of ${lines.length} lines`
  }
  if (output.lines.some((line) => !storableText(line.text))) {
    return 'the normalization holds a NUL character or a lone surrogate'
  }
  const expanded = new Set<string>()
  for (const expansion of output.expansions) {
    const before = expanded.size
    output.lines.forEach((line, index) =>
      line.words.forEach((word, at) => {
        if (lines[index]?.words[at]?.text === expansion.from && word.text === expansion.to) {
          expanded.add(`${index}:${at}`)
        }
      }),
    )
    if (expanded.size === before) return 'an expansion does not match a word of the lines'
  }
  for (const [index, line] of output.lines.entries()) {
    const read = lines[index]
    const problem = read && lineProblem(index, read, line, expanded)
    if (problem) return problem
  }
  return undefined
}

export const assertNormalized = (lines: Line[], output: NormalizeOutput): NormalizeOutput => {
  const problem = normalizationProblem(lines, output)
  if (problem) throw new Error(problem)
  return output
}

const maxOutputTokens = 8192

const promptValues = (lines: Line[], hints: Hints | undefined) => ({
  ...hintValues(hints),
  lines: JSON.stringify(
    lines.map((line) => ({
      text: line.words.map((word) => word.text).join(' '),
      words: line.words.map((word) => ({ text: word.text, uncertain: word.uncertain })),
    })),
  ),
})

export const createLlmNormalizer = (llm: LlmProvider): Normalizer => {
  const prompt = loadPrompt('normalize')
  return {
    normalize: async ({ lines, hints, signal, log }) => {
      if (!isRussianOrUnmarked(hints)) return null
      const schema = normalizeOutputSchema.superRefine((output, context) => {
        const problem = normalizationProblem(lines, output)
        if (problem) context.addIssue({ code: 'custom', message: problem })
      })
      const startedAt = Date.now()
      const { value, model, usage } = await llm.complete({
        system: prompt.system,
        content: [{ type: 'text', text: renderPrompt(prompt.user, promptValues(lines, hints)) }],
        schema,
        maxTokens: maxOutputTokens,
        signal,
        log,
      })
      log?.info(
        { model, usage, durationMs: Date.now() - startedAt, expansions: value.expansions.length },
        'lines normalized',
      )
      return value
    },
  }
}

export const selectNormalizer = (
  config: Config,
  budget: CallBudget,
  makeProvider: ProviderFactory = createProvider,
): Normalizer => {
  if (config.LLM_FIXTURES) return passthroughNormalizer
  const llm = selectProvider(
    config,
    budget,
    {
      primary: config.LLM_MODEL_PRIMARY,
      fallback: config.LLM_MODEL_FALLBACK,
      effort: config.LLM_EFFORT,
      primaryLimitMs: normalizePrimaryLimitMs,
    },
    makeProvider,
  )
  return llm ? createLlmNormalizer(llm) : passthroughNormalizer
}
