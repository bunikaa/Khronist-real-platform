import { describe, expect, it } from 'vitest'
import {
  boxSchema,
  createRecognitionRequestSchema,
  healthResponseSchema,
  recognitionFailureCodeSchema,
  hasValidAnswer,
  htrVisionOutputSchema,
  searchQuerySchema,
  shelfmarkBaseSchema,
  shelfmarkSchema,
  visionToLines,
} from '../src/index.ts'

describe('visionToLines', () => {
  it('splits the selected area into equal estimated strips', () => {
    const output = htrVisionOutputSchema.parse({
      lines: [
        {
          text: 'Села Борщаговки',
          words: [
            { text: 'Села', uncertain: false },
            { text: 'Борщаговки', uncertain: false },
          ],
        },
        {
          text: 'крестьянинъ Іоаннъ',
          words: [
            { text: 'крестьянинъ', uncertain: false },
            { text: 'Іоаннъ', uncertain: true },
          ],
        },
      ],
    })
    const lines = visionToLines(output)
    expect(lines).toHaveLength(2)
    expect(lines[0]?.box).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
    expect(lines[1]?.box).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
    expect(lines.every((l) => l.boxSource === 'estimated')).toBe(true)
    expect(lines.map((l) => l.uncertain)).toEqual([false, true])
  })
})

describe('shelfmarkSchema', () => {
  const base = { archive: 'ЦДІАК', fond: '127', opys: '1078', sprava: '177' }

  it('accepts an ARCHIUM image number without a folio', () => {
    const parsed = shelfmarkSchema.parse({ ...base, image: 6, portal: 'archium' })
    expect(parsed.image).toBe(6)
    expect(parsed.folio).toBeUndefined()
  })

  it('accepts a folio entered by hand', () => {
    expect(shelfmarkSchema.safeParse({ ...base, folio: '14зв' }).success).toBe(true)
  })

  it('rejects a shelfmark with neither folio nor image', () => {
    expect(shelfmarkSchema.safeParse(base).success).toBe(false)
  })

  it('allows picking fields from the base schema', () => {
    const picked = shelfmarkBaseSchema.pick({ fond: true, opys: true })
    expect(picked.parse({ fond: '127', opys: '1078' })).toEqual({ fond: '127', opys: '1078' })
  })

  it('rejects non-http portal links', () => {
    const result = shelfmarkSchema.safeParse({ ...base, image: 1, portalUrl: 'javascript:alert(1)' })
    expect(result.success).toBe(false)
  })

  it('rejects the retired searcharchives portal value', () => {
    expect(shelfmarkSchema.safeParse({ ...base, image: 1, portal: 'searcharchives' }).success).toBe(false)
  })
})

describe('createRecognitionRequestSchema', () => {
  it('rejects a malformed image hash', () => {
    const result = createRecognitionRequestSchema.safeParse({
      image: { base64Png: 'AAAA' },
      imageHash: 'nope',
      source: 'extension',
    })
    expect(result.success).toBe(false)
  })
})

describe('searchQuerySchema', () => {
  it('parses verifiedOnly=false as false, not true', () => {
    const parsed = searchQuerySchema.parse({ q: 'Коваленко', verifiedOnly: 'false' })
    expect(parsed.verifiedOnly).toBe(false)
    expect(parsed.limit).toBe(20)
  })
})

describe('hasValidAnswer', () => {
  it('treats an answer without citations as no answer', () => {
    expect(hasValidAnswer({ answer: 'текст', citations: [] })).toBe(false)
    expect(hasValidAnswer({ answer: null, citations: [{}] })).toBe(false)
    expect(hasValidAnswer({ answer: 'текст', citations: [{}] })).toBe(true)
  })
})

describe('boxSchema', () => {
  it('accepts a box inside the image and tolerates float error on the edge', () => {
    expect(boxSchema.safeParse({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }).success).toBe(true)
    expect(boxSchema.safeParse({ x: 0.5, y: 0, w: 0.5000001, h: 1 }).success).toBe(true)
  })

  it('rejects empty, negative and overflowing boxes', () => {
    expect(boxSchema.safeParse({ x: 0, y: 0, w: 0, h: 0.5 }).success).toBe(false)
    expect(boxSchema.safeParse({ x: 0.9, y: 0, w: 0.5, h: 0.5 }).success).toBe(false)
    expect(boxSchema.safeParse({ x: 0, y: 0.6, w: 0.5, h: 0.5 }).success).toBe(false)
    expect(boxSchema.safeParse({ x: -0.1, y: 0, w: 0.5, h: 0.5 }).success).toBe(false)
  })
})

describe('shelfmark limits', () => {
  const base = { archive: 'A', fond: '127', opys: '1078', sprava: '177', image: 1 }

  it('trims whitespace and rejects blank and over-long parts', () => {
    expect(shelfmarkSchema.parse({ ...base, sprava: ' 177 ' }).sprava).toBe('177')
    expect(shelfmarkSchema.safeParse({ ...base, sprava: '   ' }).success).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, archive: 'x'.repeat(65) }).success).toBe(false)
  })

  it('rejects a control character and an out-of-range image number', () => {
    expect(shelfmarkSchema.safeParse({ ...base, fond: `1${String.fromCharCode(0)}2` }).success).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, image: 2 ** 31 }).success).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, image: 100001 }).success).toBe(false)
  })

  it('rejects a portal link with credentials or a non-http scheme', () => {
    expect(shelfmarkSchema.safeParse({ ...base, portalUrl: 'https://u:p@example.org/' }).success).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, portalUrl: 'ftp://example.org/' }).success).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, portalUrl: 'https://example.org/x' }).success).toBe(true)
  })
})

describe('shared enums', () => {
  it('knows the fixture reader status and the save failure code', () => {
    expect(healthResponseSchema.safeParse({ ok: true, db: 'ok', llm: 'ok', htr: 'fixture' }).success).toBe(true)
    expect(recognitionFailureCodeSchema.safeParse('save_failed').success).toBe(true)
  })
})
