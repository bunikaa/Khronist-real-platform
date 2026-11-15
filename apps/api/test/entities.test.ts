import type { EntitiesOutput } from '@khronist/contracts'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { hasKeyFor, loadConfig } from '../src/config.ts'
import {
  assertEntitiesFit,
  createLlmEntityExtractor,
  noEntities,
  placeEntities,
  selectEntityExtractor,
} from '../src/services/entities.ts'
import { parseOutput, type LlmProvider, type LlmRequest } from '../src/services/llm/index.ts'
import type { ProviderFactory } from '../src/services/llm/select.ts'
import { unlimitedBudget } from './helpers.ts'

type Found = EntitiesOutput['entities']

const text = 'Священник Иоанн Петров\nкрестьянин Иоанн Ша-\nповал'

describe('placeEntities', () => {
  it('places every occurrence after the previous one', () => {
    const found: Found = [
      { type: 'term', text: 'Священник', normalized: 'священник' },
      { type: 'person', text: 'Иоанн', normalized: 'Иоанн' },
      { type: 'term', text: 'крестьянин', normalized: 'крестьянин' },
      { type: 'person', text: 'Иоанн', normalized: 'Иоанн' },
    ]
    const { placed, dropped } = placeEntities(text, found)
    expect(dropped).toBe(0)
    expect(placed.map((entity) => [entity.start, entity.end])).toEqual([
      [0, 9],
      [10, 15],
      [23, 33],
      [34, 39],
    ])
  })

  it('looks from the start for an entity out of order without moving on', () => {
    const found: Found = [
      { type: 'term', text: 'крестьянин', normalized: 'крестьянин' },
      { type: 'term', text: 'Священник', normalized: 'священник' },
      { type: 'person', text: 'Иоанн', normalized: 'Иоанн' },
    ]
    const { placed } = placeEntities(text, found)
    expect(placed.map((entity) => entity.start)).toEqual([23, 0, 34])
  })

  it('ignores case and Unicode composition and keeps the text as written', () => {
    const decomposed = 'Андрей Мойсеевич'
    const { placed } = placeEntities(decomposed, [
      { type: 'person', text: 'андрей мойсеевич', normalized: 'Андрей Мойсеевич' },
    ])
    expect(placed).toEqual([
      {
        type: 'person',
        text: decomposed,
        start: 0,
        end: decomposed.length,
        normalized: 'Андрей Мойсеевич',
      },
    ])
  })

  it('finds a word broken across lines with its hyphen and line break', () => {
    const { placed } = placeEntities(text, [
      { type: 'person', text: 'Иоанн Ша-\nповал', normalized: 'Иоанн Шаповал' },
    ])
    expect(placed[0]?.text).toBe('Иоанн Ша-\nповал')
  })

  it('drops what is not in the text and empty entities, and goes on', () => {
    const { placed, dropped } = placeEntities(text, [
      { type: 'place', text: 'Борщаговка', normalized: 'Борщаговка' },
      { type: 'term', text: '', normalized: '' },
      { type: 'person', text: 'Петров', normalized: '' },
    ])
    expect(dropped).toBe(2)
    expect(placed).toEqual([{ type: 'person', text: 'Петров', start: 16, end: 22 }])
  })

  it('folds the entity the same way as the text', () => {
    const { placed } = placeEntities('ΟΔΟΣ', [{ type: 'place', text: 'ΟΔΟΣ', normalized: '' }])
    expect(placed).toEqual([{ type: 'place', text: 'ΟΔΟΣ', start: 0, end: 4 }])
  })

  it('keeps only a short, plain normalized form', () => {
    const forms = ['  Иоанн  ', 'И'.repeat(201), 'Ио\u0000анн', 'Ио\u202Eанн', 'Иоанн\nПетров']
    const { placed } = placeEntities(
      'Иоанн Иоанн Иоанн Иоанн Иоанн',
      forms.map((normalized) => ({ type: 'person', text: 'Иоанн', normalized })),
    )
    expect(placed.map((entity) => entity.normalized)).toEqual([
      'Иоанн',
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('places the same entity on the same span once and at most 200 entities', () => {
    const repeated = placeEntities(text, [
      { type: 'term', text: 'крестьянин', normalized: 'крестьянин' },
      { type: 'term', text: 'крестьянин', normalized: 'крестьянин' },
    ])
    expect(repeated.placed).toHaveLength(1)
    expect(repeated.dropped).toBe(1)
    const many = Array.from({ length: 300 }, () => 'Иоанн').join(' ')
    const { placed } = placeEntities(
      many,
      Array.from({ length: 300 }, () => ({
        type: 'person' as const,
        text: 'Иоанн',
        normalized: '',
      })),
    )
    expect(placed).toHaveLength(200)
  })

  it('places every entity of the examples of the prompt', () => {
    type Example = { input: { text: string }; output: { entities: Found } }
    const examples: Example[] = readFileSync(
      new URL('../../../packages/prompts/entities/examples.jsonl', import.meta.url),
      'utf8',
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(examples).toHaveLength(6)
    for (const { input, output } of examples) {
      const { placed, dropped } = placeEntities(input.text, output.entities)
      expect(dropped).toBe(0)
      expect(() => assertEntitiesFit(input.text, placed)).not.toThrow()
    }
  })
})

describe('assertEntitiesFit', () => {
  it.each([
    ['text that is not at its span', { text: 'Петров', start: 0, end: 6 }],
    ['an empty span', { text: '', start: 3, end: 3 }],
    ['a span past the end', { text: 'л', start: text.length, end: text.length + 1 }],
  ])('rejects %s', (_, span) => {
    expect(() => assertEntitiesFit(text, [{ type: 'person', ...span }])).toThrow(
      /does not match its span/,
    )
  })
})

const answering = (entities: Found) => {
  const requests: LlmRequest<unknown>[] = []
  const provider: LlmProvider = {
    name: 'claude-test',
    complete: async (request) => {
      requests.push(request)
      return {
        value: parseOutput(JSON.stringify({ entities }), request.schema),
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

describe('createLlmEntityExtractor', () => {
  const found: Found = [
    { type: 'person', text: 'Иоанн', normalized: 'Иоанн' },
    { type: 'place', text: 'Борщаговка', normalized: 'Борщаговка' },
  ]

  it('sends the text and hints and places what the model found', async () => {
    const { provider, requests } = answering(found)
    const info = vi.fn()
    const placed = await createLlmEntityExtractor(provider).extract({
      normalizedText: text,
      hints: { language: 'ru', period: '19' },
      log: { info, warn: () => {} },
    })
    expect(placed).toEqual([
      { type: 'person', text: 'Иоанн', start: 10, end: 15, normalized: 'Иоанн' },
    ])
    expect(promptOf(requests[0])).toContain(text)
    expect(promptOf(requests[0])).toContain('Century: 19')
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ found: 1, dropped: 1 }),
      'entities found',
    )
  })

  it('does not call the model for other languages or an empty text', async () => {
    const { provider, requests } = answering(found)
    const extractor = createLlmEntityExtractor(provider)
    for (const language of ['uk', 'pl', 'church-slavonic'] as const) {
      expect(await extractor.extract({ normalizedText: text, hints: { language } })).toEqual([])
    }
    expect(await extractor.extract({ normalizedText: ' \n ' })).toEqual([])
    expect(requests).toHaveLength(0)
  })
})

describe('selectEntityExtractor', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }
  const recording = () => {
    const made: { model: string; effort: string }[] = []
    const makeProvider: ProviderFactory = (config, { model, effort }) => {
      if (!hasKeyFor(config, model)) return undefined
      made.push({ model, effort })
      return answering([]).provider
    }
    return { made, makeProvider }
  }

  it('finds nothing with fixtures or without a key', () => {
    const { made, makeProvider } = recording()
    const fixtures = loadConfig({ ...base, LLM_FIXTURES: '1', ANTHROPIC_API_KEY: 'k' })
    expect(selectEntityExtractor(fixtures, unlimitedBudget, makeProvider)).toBe(noEntities)
    expect(selectEntityExtractor(loadConfig(base), unlimitedBudget, makeProvider)).toBe(noEntities)
    expect(made).toHaveLength(0)
  })

  it('uses the text model and its effort', async () => {
    const { made, makeProvider } = recording()
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: 'k', LLM_EFFORT: 'low' })
    await selectEntityExtractor(config, unlimitedBudget, makeProvider).extract({
      normalizedText: text,
    })
    expect(made).toEqual([{ model: 'claude-sonnet-5-5', effort: 'low' }])
  })
})
