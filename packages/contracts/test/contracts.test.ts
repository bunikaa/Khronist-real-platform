import { describe, expect, it } from 'vitest'
import {
  adminChunksRequestSchema,
  adminSourcesRequestSchema,
  boxSchema,
  chatRequestSchema,
  createRecognitionRequestSchema,
  explainRequestSchema,
  htrVisionOutputSchema,
  isGroundedQuote,
  pageLookupQuerySchema,
  patchLinesRequestSchema,
  searchQuerySchema,
  sessionResponseSchema,
  shelfmarkSchema,
  verifyRequestSchema,
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

  it('keeps the strips equal for any number of lines', () => {
    const line = { text: 'оба', words: [{ text: 'оба', uncertain: false }] }
    const lines = visionToLines(htrVisionOutputSchema.parse({ lines: [line, line, line, line] }))
    expect(lines.map((l) => l.box.y)).toEqual([0, 0.25, 0.5, 0.75])
    expect(lines.every((l) => l.box.h === 0.25)).toBe(true)
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

  it('rejects the retired searcharchives portal value', () => {
    expect(shelfmarkSchema.safeParse({ ...base, image: 1, portal: 'searcharchives' }).success).toBe(
      false,
    )
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

describe('pageLookupQuerySchema', () => {
  const base = { archive: 'ЦДІАК', fond: '127', opys: '1078', sprava: '177' }

  it('reads the image number from the query string', () => {
    expect(pageLookupQuerySchema.parse({ ...base, image: '4' }).image).toBe(4)
  })

  it('needs a folio or an image', () => {
    expect(pageLookupQuerySchema.safeParse(base).success).toBe(false)
    expect(pageLookupQuerySchema.safeParse({ ...base, folio: '14зв' }).success).toBe(true)
  })

  it('rejects an image that is not a positive whole number', () => {
    expect(pageLookupQuerySchema.safeParse({ ...base, image: '0' }).success).toBe(false)
    expect(pageLookupQuerySchema.safeParse({ ...base, image: 'abc' }).success).toBe(false)
  })
})

describe('isGroundedQuote', () => {
  const source = 'Восприемники — хрещені батьки, які тримають дитину під час хрещення.'

  it('accepts a quote of three words or fifteen characters at word boundaries', () => {
    expect(isGroundedQuote('хрещені батьки, які', source)).toBe(true)
    expect(isGroundedQuote('під час хрещення.', source)).toBe(true)
  })

  it('rejects a short quote', () => {
    expect(isGroundedQuote('і', 'дитину і батьків')).toBe(false)
    expect(isGroundedQuote('хрещені', source)).toBe(false)
  })

  it('rejects a quote cut inside a word', () => {
    expect(isGroundedQuote('рещені батьки, які', source)).toBe(false)
    expect(isGroundedQuote('хрещені батьки, як', source)).toBe(false)
  })

  it('rejects a quote that is not in the source', () => {
    expect(isGroundedQuote('хрещені матері, які', source)).toBe(false)
  })
})

describe('request limits', () => {
  it('bounds the text to explain and takes the period from hints', () => {
    expect(explainRequestSchema.safeParse({ kind: 'term', text: 'x'.repeat(200) }).success).toBe(
      true,
    )
    expect(explainRequestSchema.safeParse({ kind: 'term', text: 'x'.repeat(201) }).success).toBe(
      false,
    )
    expect(
      explainRequestSchema.safeParse({
        kind: 'term',
        text: 'псаломщик',
        context: { period: 'XIX' },
      }).success,
    ).toBe(false)
    expect(
      chatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Хто хрестив?' }],
        context: { period: '19' },
      }).success,
    ).toBe(true)
  })

  it('bounds the chat history and ends it with a question from the user', () => {
    const question = { role: 'user' as const, content: 'Хто хрестив?' }
    const answer = { role: 'assistant' as const, content: 'Священник.' }
    expect(chatRequestSchema.safeParse({ messages: [question, answer] }).success).toBe(false)
    expect(chatRequestSchema.safeParse({ messages: Array(21).fill(question) }).success).toBe(false)
    expect(
      chatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'x'.repeat(2001) }] })
        .success,
    ).toBe(false)
    expect(
      chatRequestSchema.safeParse({ messages: [{ role: 'user', content: '  ' }] }).success,
    ).toBe(false)
  })

  it('bounds the search query', () => {
    expect(searchQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false)
  })

  it('takes single-line edits with unique indexes', () => {
    const line = (idx: number, text = 'Села Борщаговки') => ({ idx, text })
    expect(patchLinesRequestSchema.safeParse({ baseVersion: 1, lines: [line(0)] }).success).toBe(
      true,
    )
    expect(
      patchLinesRequestSchema.safeParse({ baseVersion: 1, lines: [line(0), line(0)] }).success,
    ).toBe(false)
    expect(
      patchLinesRequestSchema.safeParse({ baseVersion: 1, lines: [line(0, 'а\nб')] }).success,
    ).toBe(false)
    expect(
      patchLinesRequestSchema.safeParse({ baseVersion: 1, lines: [line(0, 'x'.repeat(501))] })
        .success,
    ).toBe(false)
    expect(
      patchLinesRequestSchema.safeParse({
        baseVersion: 1,
        lines: Array.from({ length: 201 }, (_, i) => line(i)),
      }).success,
    ).toBe(false)
  })

  it('bounds the signature and rejects control characters in it', () => {
    expect(verifyRequestSchema.parse({ signature: ' Олена Коваль ' }).signature).toBe(
      'Олена Коваль',
    )
    expect(verifyRequestSchema.safeParse({ signature: 'x'.repeat(81) }).success).toBe(false)
    expect(verifyRequestSchema.safeParse({ signature: 'а‮б' }).success).toBe(true)
    expect(verifyRequestSchema.safeParse({ signature: 'а\u0007б' }).success).toBe(false)
  })
})

describe('admin contracts', () => {
  const chunk = {
    articleKey: 'psalomshchik',
    idx: 0,
    sourceId: '0195f2b4-7c1e-7000-8000-000000000001',
    text: 'Псаломщик — церковнослужитель.',
    topic: 'псаломщик',
    type: 'term',
    periodFrom: 18,
    periodTo: 19,
  }

  it('keys chunks by article and index', () => {
    expect(
      adminChunksRequestSchema.safeParse({ items: [chunk, { ...chunk, idx: 1 }] }).success,
    ).toBe(true)
    expect(adminChunksRequestSchema.safeParse({ items: [chunk, chunk] }).success).toBe(false)
  })

  it('rejects an inverted period and a non-https source', () => {
    expect(
      adminChunksRequestSchema.safeParse({ items: [{ ...chunk, periodFrom: 20, periodTo: 19 }] })
        .success,
    ).toBe(false)
    const source = {
      url: 'https://ru.wikisource.org/wiki/ЭСБЕ/Псаломщик',
      title: 'ЭСБЕ',
      licence: 'суспільне надбання',
      kind: 'encyclopedia',
      periodFrom: 19,
      periodTo: 19,
    }
    expect(adminSourcesRequestSchema.safeParse({ items: [source] }).success).toBe(true)
    expect(
      adminSourcesRequestSchema.safeParse({ items: [{ ...source, url: 'http://example.org' }] })
        .success,
    ).toBe(false)
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
    for (const code of [0, 1, 10, 13, 127]) {
      const fond = `1${String.fromCharCode(code)}2`
      expect(shelfmarkSchema.safeParse({ ...base, image: 1, fond }).success, `code ${code}`).toBe(
        false,
      )
    }
    expect(shelfmarkSchema.safeParse({ ...base, image: 2 ** 31 }).success).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, image: 100001 }).success).toBe(false)
  })

  it('rejects a portal link with credentials or a non-http scheme', () => {
    expect(
      shelfmarkSchema.safeParse({ ...base, portalUrl: 'https://u:p@example.org/' }).success,
    ).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, portalUrl: 'ftp://example.org/' }).success).toBe(
      false,
    )
    expect(shelfmarkSchema.safeParse({ ...base, portalUrl: '' }).success).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, portalUrl: 'example.org/x' }).success).toBe(false)
    expect(shelfmarkSchema.safeParse({ ...base, portalUrl: 'https://example.org/x' }).success).toBe(
      true,
    )
  })
})

describe('sessionResponseSchema', () => {
  const user = { id: 'user-1', email: 'olena.k@khronist.example', name: '' }

  it.each([
    ['a signed-in verifier', { session: { id: 's' }, user, canVerify: true }, true],
    ['a signed-in reader', { session: { id: 's' }, user, canVerify: false }, true],
    ['no session', null, true],
    ['a session without canVerify', { session: { id: 's' }, user }, false],
    ['canVerify as a string', { session: { id: 's' }, user, canVerify: 'true' }, false],
  ])('checks %s', (_case, body, valid) => {
    expect(sessionResponseSchema.safeParse(body).success).toBe(valid)
  })
})
