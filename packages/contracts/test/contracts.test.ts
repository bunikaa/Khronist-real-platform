import { describe, expect, it } from 'vitest'
import {
  createRecognitionRequestSchema,
  hasValidAnswer,
  htrVisionOutputSchema,
  searchQuerySchema,
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
