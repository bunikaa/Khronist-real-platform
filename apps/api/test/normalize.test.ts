import type { Line, NormalizeOutput } from '@khronist/contracts'
import { readFileSync } from 'node:fs'
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
  createLlmNormalizer,
  normalizationProblem,
  passthroughNormalizer,
  selectNormalizer,
  spellingKey,
} from '../src/services/normalize.ts'
import { unlimitedBudget } from './helpers.ts'

const lines: Line[] = [
  {
    idx: 0,
    text: 'Священникъ Іоаннъ',
    box: { x: 0, y: 0, w: 1, h: 0.5 },
    boxSource: 'estimated',
    uncertain: true,
    words: [
      { text: 'Священникъ', uncertain: false, confidence: 0.9 },
      { text: 'Іоаннъ', uncertain: true },
    ],
  },
]

const normalized: NormalizeOutput = {
  lines: [
    {
      text: 'Священник Иоанн',
      words: [
        { text: 'Священник', uncertain: false },
        { text: 'Иоанн', uncertain: true },
      ],
    },
  ],
  expansions: [],
}

const brokenOutputs: Record<string, NormalizeOutput> = {
  'a missing line': { lines: [], expansions: [] },
  'a missing word': {
    lines: [{ text: 'Священник', words: [{ text: 'Священник', uncertain: false }] }],
    expansions: [],
  },
  'words that do not add up to the text': {
    lines: [{ ...normalized.lines[0]!, text: 'Священник  Иоанн' }],
    expansions: [],
  },
  'an empty word': {
    lines: [
      {
        text: 'Священник ',
        words: [
          { text: 'Священник', uncertain: false },
          { text: '', uncertain: true },
        ],
      },
    ],
    expansions: [],
  },
  'another name': {
    lines: [
      {
        text: 'Священник Иван',
        words: [
          { text: 'Священник', uncertain: false },
          { text: 'Иван', uncertain: true },
        ],
      },
    ],
    expansions: [],
  },
  'an expansion of a word that is not there': {
    ...normalized,
    expansions: [{ from: 'Свящ.', to: 'Священник' }],
  },
  'a lost uncertain word': {
    lines: [
      {
        text: 'Священник Иоанн',
        words: [
          { text: 'Священник', uncertain: false },
          { text: 'Иоанн', uncertain: false },
        ],
      },
    ],
    expansions: [],
  },
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

describe('createLlmNormalizer', () => {
  it('normalizes Russian and unmarked lines', async () => {
    const { provider, requests } = answering(normalized)
    const normalizer = createLlmNormalizer(provider)
    expect(await normalizer.normalize({ lines })).toEqual(normalized)
    expect(
      await normalizer.normalize({
        lines,
        hints: { language: 'ru', period: '19', documentType: 'metric' },
      }),
    ).toEqual(normalized)
    expect(promptOf(requests[0])).toContain('Language: unknown')
    expect(promptOf(requests[1])).toContain('Language: ru')
    expect(promptOf(requests[1])).toContain('Century: 19')
    expect(promptOf(requests[1])).toContain('Document type: metric')
  })

  it('sends the model only the text of the lines and the uncertainty of words', async () => {
    const { provider, requests } = answering(normalized)
    await createLlmNormalizer(provider).normalize({ lines })
    expect(promptOf(requests[0])).toContain(
      JSON.stringify([
        {
          text: 'Священникъ Іоаннъ',
          words: [
            { text: 'Священникъ', uncertain: false },
            { text: 'Іоаннъ', uncertain: true },
          ],
        },
      ]),
    )
    expect(promptOf(requests[0])).not.toContain('confidence')
    expect(promptOf(requests[0])).not.toContain('box')
  })

  it('builds the text of a line from its words, so stray spaces do not reach the model', async () => {
    const { provider, requests } = answering(normalized)
    const spaced = [{ ...lines[0]!, text: ' Священникъ  Іоаннъ ' }]
    expect(await createLlmNormalizer(provider).normalize({ lines: spaced })).toEqual(normalized)
    expect(promptOf(requests[0])).toContain('"text":"Священникъ Іоаннъ"')
  })

  it('does not call the model for other languages', async () => {
    const { provider, requests } = answering(normalized)
    const normalizer = createLlmNormalizer(provider)
    for (const language of ['uk', 'pl', 'church-slavonic'] as const) {
      expect(await normalizer.normalize({ lines, hints: { language } })).toBeNull()
    }
    expect(requests).toHaveLength(0)
  })

  it.each(Object.entries(brokenOutputs))(
    'treats an output with %s as invalid',
    async (_, broken) => {
      const { provider } = answering(broken)
      await expect(createLlmNormalizer(provider).normalize({ lines })).rejects.toBeInstanceOf(
        LlmOutputError,
      )
    },
  )

  it('asks the model once more when its output breaks the contract', async () => {
    const { provider, requests } = answering(brokenOutputs['a missing word'], normalized)
    const normalizer = createLlmNormalizer(withFallback(provider, undefined, 1000))
    expect(await normalizer.normalize({ lines })).toEqual(normalized)
    expect(requests).toHaveLength(2)
  })
})

const lineOf = (words: { text: string; uncertain: boolean }[], idx = 0): Line => ({
  idx,
  text: words.map((word) => word.text).join(' '),
  box: { x: 0, y: 0, w: 1, h: 1 },
  boxSource: 'estimated',
  uncertain: words.some((word) => word.uncertain),
  words,
})

const outputOf = (texts: string[], read: Line): NormalizeOutput => ({
  lines: [
    {
      text: texts.join(' '),
      words: texts.map((text, at) => ({ text, uncertain: read.words[at]?.uncertain ?? false })),
    },
  ],
  expansions: [],
})

describe('normalizationProblem', () => {
  type Example = {
    input: { lines: { words: { text: string; uncertain: boolean }[] }[] }
    output: NormalizeOutput
  }
  const examples: Example[] = readFileSync(
    new URL('../../../packages/prompts/normalize/examples.jsonl', import.meta.url),
    'utf8',
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

  it('accepts every normalization from the examples of the prompt', () => {
    expect(examples).toHaveLength(6)
    for (const example of examples) {
      const read = example.input.lines.map((line, idx) => lineOf(line.words, idx))
      expect(normalizationProblem(read, example.output)).toBeUndefined()
    }
  })

  it.each([
    ['Іоаннъ,', 'Иоанн,'],
    ['исповѣданія', 'исповедания'],
    ['православнаго', 'православного'],
    ['лучшаго', 'лучшего'],
    ['синяго', 'синего'],
    ['безпорочныя', 'беспорочные'],
    ['Ѳеодоръ-', 'Феодор-'],
    ['подъемъ', 'подъем'],
    ['онѣ', 'они'],
    ['однѣхъ', 'одних'],
    ['ея', 'её'],
    ['Мѵро', 'Миро'],
    ['[нрзб]', '[нрзб]'],
  ])('lets %s become %s', (from, to) => {
    expect(spellingKey(from)).toBe(spellingKey(to))
  })

  it.each([
    ['Іоаннъ', 'Иван'],
    ['Аѳанасія', 'Анафасия'],
    ['Иларіонъ', 'Илярион'],
    ['Ѳеодоръ', 'Федор'],
    ['подъемъ', 'подьем'],
  ])('does not let %s become %s', (from, to) => {
    expect(spellingKey(from)).not.toBe(spellingKey(to))
  })

  it('lets an expansion change its word, and only at its place', () => {
    const read = lineOf([
      { text: 'Свящ.', uncertain: false },
      { text: 'Іоаннъ', uncertain: false },
    ])
    const expanded = {
      ...outputOf(['Священник', 'Иоанн'], read),
      expansions: [{ from: 'Свящ.', to: 'Священник' }],
    }
    expect(normalizationProblem([read], expanded)).toBeUndefined()
    expect(normalizationProblem([read], { ...expanded, expansions: [] })).toMatch(
      /changes more than the spelling/,
    )
  })

  it.each([
    ['a NUL character', 'Свящ\u0000'],
    ['a lone surrogate', 'Священник\ud800'],
  ])('refuses an expansion with %s, which the database cannot store', (_case, to) => {
    const read = lineOf([
      { text: 'Свящ.', uncertain: false },
      { text: 'Іоаннъ', uncertain: false },
    ])
    const expanded = {
      ...outputOf([to, 'Иоанн'], read),
      expansions: [{ from: 'Свящ.', to }],
    }
    expect(normalizationProblem([read], expanded)).toMatch(/NUL character or a lone surrogate/)
  })
})

describe('selectNormalizer', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }
  const recording = () => {
    const made: { model: string; effort: string }[] = []
    const makeProvider: ProviderFactory = (config, { model, effort }) => {
      if (!hasKeyFor(config, model)) return undefined
      made.push({ model, effort })
      return answering(normalized).provider
    }
    return { made, makeProvider }
  }

  it('keeps the lines as read with fixtures or without a key', () => {
    const { made, makeProvider } = recording()
    const fixtures = loadConfig({ ...base, LLM_FIXTURES: '1', ANTHROPIC_API_KEY: 'k' })
    expect(selectNormalizer(fixtures, unlimitedBudget, makeProvider)).toBe(passthroughNormalizer)
    expect(selectNormalizer(loadConfig(base), unlimitedBudget, makeProvider)).toBe(
      passthroughNormalizer,
    )
    expect(made).toHaveLength(0)
  })

  it('saves no call beyond the daily budget', async () => {
    const { makeProvider } = recording()
    const spent = { spend: async () => false, available: async () => false }
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' })
    await expect(
      selectNormalizer(config, spent, makeProvider).normalize({ lines }),
    ).rejects.toBeInstanceOf(LlmLimitError)
  })

  it('uses the text models and their effort, not the reading ones', async () => {
    const { made, makeProvider } = recording()
    const config = loadConfig({
      ...base,
      ANTHROPIC_API_KEY: 'k',
      LLM_MODEL_FALLBACK: 'claude-haiku-5-5',
      LLM_EFFORT: 'low',
    })
    const normalizer = selectNormalizer(config, unlimitedBudget, makeProvider)
    expect(await normalizer.normalize({ lines })).toEqual(normalized)
    expect(made).toEqual([
      { model: 'claude-sonnet-5-5', effort: 'low' },
      { model: 'claude-haiku-5-5', effort: 'low' },
    ])
  })
})
