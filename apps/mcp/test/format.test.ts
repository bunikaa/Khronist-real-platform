import { describe, expect, it } from 'vitest'
import { explainNote, shelfmarkLabel, toTranscribeOutput } from '../src/format.ts'
import { transcription } from './fixtures.ts'

describe('shelfmarkLabel', () => {
  it('names the image when there is no folio', () => {
    expect(
      shelfmarkLabel({
        archive: 'ЦДІАК України',
        fond: '127',
        opys: '1078',
        sprava: '177',
        image: 4,
      }),
    ).toBe('ЦДІАК України, ф. 127, оп. 1078, спр. 177, зобр. 4')
  })

  it('names the folio when there is one', () => {
    expect(
      shelfmarkLabel({
        archive: 'ЦДІАК України',
        fond: '127',
        opys: '1078',
        sprava: '177',
        folio: '14зв',
      }),
    ).toBe('ЦДІАК України, ф. 127, оп. 1078, спр. 177, арк. 14зв')
  })
})

describe('toTranscribeOutput', () => {
  it('keeps the contract fields and drops boxes and words', () => {
    expect(toTranscribeOutput(transcription)).toEqual({
      transcription_id: transcription.id,
      shelfmark: 'ЦДІАК України, ф. 127, оп. 1078, спр. 2276, зобр. 21',
      lines: [{ idx: 0, text: 'Священникъ Іоаннъ', uncertain: true }],
      normalized_text: 'Священник Иоанн',
      entities: [{ type: 'person', text: 'Іоаннъ', normalized: 'Иоанн' }],
    })
  })
})

describe('explainNote', () => {
  it('says there is no answer without sources', () => {
    expect(explainNote({ answer: null, reason: 'no_sources', citations: [] })).toMatch(/^Не знаю/)
  })

  it('marks a low confidence answer as partial', () => {
    expect(explainNote({ answer: 'Так', confidence: 'low', citations: [] })).toMatch(/^Часткова/)
  })

  it('adds nothing to a confident answer', () => {
    expect(explainNote({ answer: 'Так', confidence: 'high', citations: [] })).toBeUndefined()
  })
})
