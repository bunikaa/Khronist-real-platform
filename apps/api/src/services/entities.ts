import {
  entitiesOutputSchema,
  type EntitiesOutput,
  type Entity,
  type Hints,
} from '@khronist/contracts'
import { loadPrompt, renderPrompt } from '@khronist/prompts'
import type { Config } from '../config.ts'
import { entitiesPrimaryLimitMs } from '../lib/limits.ts'
import { hintValues, isRussianOrUnmarked } from './hints.ts'
import type { CallBudget, LlmCallLog, LlmProvider } from './llm/index.ts'
import { createProvider, selectProvider, type ProviderFactory } from './llm/select.ts'

type ExtractInput = {
  normalizedText: string
  hints?: Hints | undefined
  signal?: AbortSignal | undefined
  log?: LlmCallLog | undefined
}

export type EntityExtractor = {
  extract: (input: ExtractInput) => Promise<Entity[]>
}

export const noEntities: EntityExtractor = { extract: async () => [] }

const foldedUnits = (text: string) => {
  let folded = ''
  const starts: number[] = []
  const ends: number[] = []
  let at = 0
  for (const unit of text.match(/\P{M}\p{M}*|\p{M}+/gu) ?? []) {
    const form = unit.normalize('NFC').toLowerCase()
    for (let index = 0; index < form.length; index += 1) {
      starts.push(at)
      ends.push(at + unit.length)
    }
    folded += form
    at += unit.length
  }
  return { folded, starts, ends }
}

const maxEntities = 200
const maxNormalizedLength = 200
const hiddenCharacters = /[\p{Cc}\p{Cf}]/u

const cleanNormalized = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed.length > 0 &&
    trimmed.length <= maxNormalizedLength &&
    !hiddenCharacters.test(trimmed)
    ? trimmed
    : undefined
}

export const placeEntities = (
  text: string,
  found: EntitiesOutput['entities'],
): { placed: Entity[]; dropped: number } => {
  const { folded, starts, ends } = foldedUnits(text)
  const placed: Entity[] = []
  const taken = new Set<string>()
  let cursor = 0
  for (const entity of found) {
    if (placed.length === maxEntities) break
    const needle = foldedUnits(entity.text).folded
    if (needle.length === 0) continue
    const after = folded.indexOf(needle, cursor)
    const at = after === -1 ? folded.indexOf(needle) : after
    const start = starts[at]
    const end = ends[at + needle.length - 1]
    if (at === -1 || start === undefined || end === undefined) continue
    if (after !== -1) cursor = at + needle.length
    const place = `${entity.type}:${start}:${end}`
    if (taken.has(place)) continue
    taken.add(place)
    const normalized = cleanNormalized(entity.normalized)
    placed.push({
      type: entity.type,
      text: text.slice(start, end),
      start,
      end,
      ...(normalized !== undefined && { normalized }),
    })
  }
  return { placed, dropped: found.length - placed.length }
}

export const assertEntitiesFit = (text: string, found: Entity[]): Entity[] => {
  for (const [index, entity] of found.entries()) {
    if (
      entity.end <= entity.start ||
      entity.end > text.length ||
      text.slice(entity.start, entity.end) !== entity.text
    ) {
      throw new Error(`entity ${index} does not match its span ${entity.start}-${entity.end}`)
    }
  }
  return found
}

const maxOutputTokens = 4096

export const createLlmEntityExtractor = (llm: LlmProvider): EntityExtractor => {
  const prompt = loadPrompt('entities')
  return {
    extract: async ({ normalizedText, hints, signal, log }) => {
      if (!isRussianOrUnmarked(hints) || normalizedText.trim().length === 0) return []
      const startedAt = Date.now()
      const { value, model, usage } = await llm.complete({
        system: prompt.system,
        content: [
          {
            type: 'text',
            text: renderPrompt(prompt.user, { ...hintValues(hints), text: normalizedText }),
          },
        ],
        schema: entitiesOutputSchema,
        maxTokens: maxOutputTokens,
        signal,
        log,
      })
      const { placed, dropped } = placeEntities(normalizedText, value.entities)
      log?.info(
        { model, usage, durationMs: Date.now() - startedAt, found: placed.length, dropped },
        'entities found',
      )
      return placed
    },
  }
}

export const selectEntityExtractor = (
  config: Config,
  budget: CallBudget,
  makeProvider: ProviderFactory = createProvider,
): EntityExtractor => {
  if (config.LLM_FIXTURES) return noEntities
  const llm = selectProvider(
    config,
    budget,
    {
      primary: config.LLM_MODEL_PRIMARY,
      fallback: config.LLM_MODEL_FALLBACK,
      effort: config.LLM_EFFORT,
      primaryLimitMs: entitiesPrimaryLimitMs,
    },
    makeProvider,
  )
  return llm ? createLlmEntityExtractor(llm) : noEntities
}
