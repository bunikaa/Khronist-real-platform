import type { Entity, Hints, Line } from '@khronist/contracts'

export type Normalized = {
  normalizedText: string
  entities: Entity[]
}

export type Normalizer = {
  normalize: (
    lines: Line[],
    hints?: Hints | undefined,
    signal?: AbortSignal | undefined,
  ) => Promise<Normalized>
}

export const passthroughNormalizer: Normalizer = {
  normalize: async (lines) => ({
    normalizedText: lines.map((line) => line.text).join('\n'),
    entities: [],
  }),
}
