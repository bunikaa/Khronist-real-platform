import type { Transcription } from '@khronist/contracts'

export const transcription: Transcription = {
  id: '01a1e4ff-346f-7b54-a981-ad819ff12380',
  regionId: '01a1e4ff-346f-7b54-a981-ad819ff12381',
  shelfmark: { archive: 'ЦДІАК України', fond: '127', opys: '1078', sprava: '2276', image: 21 },
  box: { x: 0.24, y: 0.25, w: 0.28, h: 0.23 },
  version: 1,
  status: 'draft',
  lines: [
    {
      idx: 0,
      text: 'Священникъ Іоаннъ',
      box: { x: 0, y: 0, w: 1, h: 0.1 },
      boxSource: 'model',
      uncertain: true,
      words: [
        { text: 'Священникъ', uncertain: false },
        { text: 'Іоаннъ', uncertain: true },
      ],
    },
  ],
  normalizedText: 'Священник Иоанн',
  entities: [{ type: 'person', text: 'Іоаннъ', start: 11, end: 17, normalized: 'Иоанн' }],
  reader: 'claude-sonnet-5-5',
  createdAt: '2026-11-16T12:00:00.000Z',
}
