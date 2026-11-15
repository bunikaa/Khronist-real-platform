import type { Entity, Hints, Line, NormalizeOutput } from '@khronist/contracts'

export type Normalizer = {
  normalize: (
    lines: Line[],
    hints?: Hints | undefined,
    signal?: AbortSignal | undefined,
  ) => Promise<NormalizeOutput | null>
}

export type EntityExtractor = {
  extract: (
    normalizedText: string,
    hints?: Hints | undefined,
    signal?: AbortSignal | undefined,
  ) => Promise<Entity[]>
}

export const passthroughNormalizer: Normalizer = { normalize: async () => null }

export const noEntities: EntityExtractor = { extract: async () => [] }
