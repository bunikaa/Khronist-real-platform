import { htrVisionOutputSchema, visionToLines } from '@khronist/contracts'
import type { HtrReader } from './index.ts'

const demonstration = htrVisionOutputSchema.parse({
  lines: [
    {
      text: 'Села Борщаговки крестьянинъ Іоаннъ Петровъ Коваленко',
      words: [
        { text: 'Села', uncertain: false },
        { text: 'Борщаговки', uncertain: false },
        { text: 'крестьянинъ', uncertain: false },
        { text: 'Іоаннъ', uncertain: false },
        { text: 'Петровъ', uncertain: false },
        { text: 'Коваленко', uncertain: false },
      ],
    },
    {
      text: 'и законная жена его Марія Григоріева',
      words: [
        { text: 'и', uncertain: false },
        { text: 'законная', uncertain: false },
        { text: 'жена', uncertain: false },
        { text: 'его', uncertain: false },
        { text: 'Марія', uncertain: false },
        { text: 'Григоріева', uncertain: true },
      ],
    },
    {
      text: 'оба православнаго исповѣданія',
      words: [
        { text: 'оба', uncertain: false },
        { text: 'православнаго', uncertain: false },
        { text: 'исповѣданія', uncertain: false },
      ],
    },
  ],
})

export const createFixtureReader = (): HtrReader => ({
  kind: 'fixture',
  read: async () => ({ lines: visionToLines(demonstration), reader: 'fixture' }),
})
