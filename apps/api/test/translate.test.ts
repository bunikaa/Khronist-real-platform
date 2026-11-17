import { maxLineLength, type TranslateOutput } from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import { hasKeyFor, loadConfig } from '../src/config.ts'
import {
  LlmLimitError,
  LlmOutputError,
  parseOutput,
  withFallback,
  type LlmProvider,
  type LlmRequest,
} from '../src/services/llm/index.ts'
import type { ProviderFactory } from '../src/services/llm/select.ts'
import {
  createLlmTranslator,
  noTranslation,
  selectTranslator,
  translationProblem,
} from '../src/services/translate.ts'
import { unlimitedBudget } from './helpers.ts'

const lines = [
  'Села Борщаговки крестьянин Иоанн Петров Коваленко',
  'и законная жена его Мария [нрзб]',
  'оба право-',
]

const translated: TranslateOutput = {
  lines: [
    'Села Борщагівки селянин Іван Петрович Коваленко',
    'і законна дружина його Марія [нрзб]',
    'обоє право-',
  ],
}

const answering = (...answers: unknown[]) => {
  const requests: LlmRequest<unknown>[] = []
  const provider: LlmProvider = {
    name: 'claude-test',
    complete: async (request) => {
      requests.push(request)
      const answer = answers[Math.min(requests.length, answers.length) - 1]
      return {
        value: parseOutput(JSON.stringify(answer), request.schema),
        model: 'claude-test',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
  }
  return { provider, requests }
}

const promptOf = (request: LlmRequest<unknown> | undefined) => {
  const part = request?.content[0]
  return part?.type === 'text' ? part.text : ''
}

const withLine = (index: number, line: string): TranslateOutput => ({
  lines: translated.lines.map((each, at) => (at === index ? line : each)),
})

describe('translationProblem', () => {
  it.each<[string, string[], TranslateOutput, RegExp | undefined]>([
    ['a faithful translation', lines, translated, undefined],
    ['a missing line', lines, { lines: translated.lines.slice(0, 2) }, /2 of 3 lines/],
    ['an extra line', lines, { lines: [...translated.lines, 'зайве'] }, /4 of 3 lines/],
    ['no lines at all', lines, { lines: [] }, /0 of 3 lines/],
    ['only blank lines', lines, { lines: ['', ' ', ''] }, /line 0: is blank/],
    ['a blank line where the source has text', lines, withLine(2, '  '), /line 2: is blank/],
    ['text where the source line is blank', ['Села', ''], { lines: ['Села', 'зайве'] }, /line 1/],
    ['a blank line kept blank', ['Села', ''], { lines: ['Села', ''] }, undefined],
    ['two lines merged into one', lines, withLine(1, 'і законна\nдружина'), /line break/],
    ['a dropped unread mark', lines, withLine(1, 'і законна дружина його Марія'), /unread/],
    [
      'an unread mark that was guessed',
      lines,
      withLine(0, `${translated.lines[0]} [нрзб]`),
      /unread/,
    ],
    ['a line at the line length', lines, withLine(0, 'а'.repeat(maxLineLength)), undefined],
    ['a line over the line length', lines, withLine(0, 'а'.repeat(maxLineLength + 1)), /500/],
    ['a line separator', lines, withLine(1, 'і законна\u2028дружина [нрзб]'), /line break/],
    ['a soft hyphen added inside a word', lines, withLine(2, 'обоє пра\u00adво-'), /hidden/],
    ['a zero-width space added', lines, withLine(2, 'обоє\u200b право-'), /hidden/],
    ['invisible text for a blank line', ['Села', ''], { lines: ['Села', '\u200b'] }, /hidden/],
    ['a tab added', lines, withLine(2, 'обоє\tправо-'), /hidden/],
    ['a BEL added', lines, withLine(2, 'обоє право-\u0007'), /hidden/],
    ['a soft hyphen kept from the source', ['пра\u00adво'], { lines: ['пра\u00adво'] }, undefined],
    ['a tab kept from the source', ['Села\t1896'], { lines: ['Села\t1896'] }, undefined],
    [
      'a blank line for an invisible source',
      ['Села', ' \u200b'],
      { lines: ['Села', ''] },
      undefined,
    ],
    ['a NUL character', lines, withLine(1, 'і законна\u0000 дружина його Марія [нрзб]'), /NUL/],
    ['a lone surrogate', lines, withLine(2, 'обоє право-\ud800'), /lone surrogate/],
    ['Latin letters in a Cyrillic line', lines, withLine(2, 'обоє Karewanowski'), /Latin/],
    ['Latin letters kept from the source', ['Rx 1896'], { lines: ['Rx 1896'] }, undefined],
  ])('%s', (_case, source, output, problem) => {
    const found = translationProblem(source, output)
    if (problem) expect(found).toMatch(problem)
    else expect(found).toBeUndefined()
  })
})

describe('createLlmTranslator', () => {
  it('translates Russian and unmarked lines and sends them as JSON with the hints', async () => {
    const { provider, requests } = answering(translated)
    const translator = createLlmTranslator(provider)
    expect(await translator.translate({ lines })).toEqual(translated)
    expect(
      await translator.translate({
        lines,
        hints: { language: 'ru', period: '19', documentType: 'metric' },
      }),
    ).toEqual(translated)
    expect(promptOf(requests[0])).toContain('Language: unknown')
    expect(promptOf(requests[0])).toContain(JSON.stringify(lines))
    expect(promptOf(requests[1])).toContain('Language: ru')
    expect(promptOf(requests[1])).toContain('Century: 19')
    expect(promptOf(requests[1])).toContain('Document type: metric')
  })

  it('does not call the model for other languages or for blank lines', async () => {
    const { provider, requests } = answering(translated)
    const translator = createLlmTranslator(provider)
    for (const language of ['uk', 'pl', 'church-slavonic'] as const) {
      expect(await translator.translate({ lines, hints: { language } })).toBeNull()
    }
    expect(await translator.translate({ lines: [] })).toBeNull()
    expect(await translator.translate({ lines: ['', '  '] })).toBeNull()
    expect(requests).toHaveLength(0)
  })

  it.each([
    ['another number of lines', { lines: translated.lines.slice(1) }],
    ['only blank lines', { lines: ['', '', ''] }],
    ['a NUL character', withLine(0, 'Села\u0000')],
  ])('treats an output with %s as invalid', async (_case, broken) => {
    const { provider } = answering(broken)
    await expect(createLlmTranslator(provider).translate({ lines })).rejects.toBeInstanceOf(
      LlmOutputError,
    )
  })

  it('asks the model once more when its output breaks the rules', async () => {
    const { provider, requests } = answering({ lines: [translated.lines.join(' ')] }, translated)
    const translator = createLlmTranslator(withFallback(provider, undefined, 1000))
    expect(await translator.translate({ lines })).toEqual(translated)
    expect(requests).toHaveLength(2)
  })
})

describe('selectTranslator', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }
  const recording = () => {
    const made: { model: string; effort: string }[] = []
    const makeProvider: ProviderFactory = (config, { model, effort }) => {
      if (!hasKeyFor(config, model)) return undefined
      made.push({ model, effort })
      return answering(translated).provider
    }
    return { made, makeProvider }
  }

  it('translates nothing with fixtures or without a key', () => {
    const { made, makeProvider } = recording()
    const fixtures = loadConfig({ ...base, LLM_FIXTURES: '1', ANTHROPIC_API_KEY: 'k' })
    expect(selectTranslator(fixtures, unlimitedBudget, makeProvider)).toBe(noTranslation)
    expect(selectTranslator(loadConfig(base), unlimitedBudget, makeProvider)).toBe(noTranslation)
    expect(made).toHaveLength(0)
  })

  it('makes no call beyond the daily budget', async () => {
    const { makeProvider } = recording()
    const spent = { spend: async () => false, available: async () => false }
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' })
    await expect(
      selectTranslator(config, spent, makeProvider).translate({ lines }),
    ).rejects.toBeInstanceOf(LlmLimitError)
  })

  it('uses the text models and their effort, not the reading ones', async () => {
    const { made, makeProvider } = recording()
    const config = loadConfig({
      ...base,
      ANTHROPIC_API_KEY: 'k',
      LLM_MODEL_FALLBACK: 'claude-haiku-5-5',
      LLM_EFFORT: 'low',
      HTR_EFFORT: 'high',
    })
    const translator = selectTranslator(config, unlimitedBudget, makeProvider)
    expect(await translator.translate({ lines })).toEqual(translated)
    expect(made).toEqual([
      { model: 'claude-sonnet-5-5', effort: 'low' },
      { model: 'claude-haiku-5-5', effort: 'low' },
    ])
  })
})
