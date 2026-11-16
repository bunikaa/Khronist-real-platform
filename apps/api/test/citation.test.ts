import type { Line, Shelfmark, Transcription } from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import { formatCitation, type CitedTranscription } from '../src/services/citation.ts'

const portalUrl = 'https://archium.cdiak.archives.gov.ua/file-viewer/131976#file-2834611'
const sprava = { archive: 'ЦДІАК України', fond: '127', opys: '1078', sprava: '177' }
const withFolio: Shelfmark = { ...sprava, folio: '14зв', image: 4, portal: 'archium', portalUrl }
const imageOnly: Shelfmark = { ...sprava, image: 4 }
const accessedAt = new Date('2026-11-17T10:00:00.000Z')

const box = { x: 0, y: 0, w: 1, h: 0.1 }
const lineOf = (idx: number, words: [string, boolean][]): Line => ({
  idx,
  text: words.map(([text]) => text).join(' '),
  box,
  boxSource: 'estimated',
  uncertain: words.some(([, uncertain]) => uncertain),
  words: words.map(([text, uncertain]) => ({ text, uncertain })),
})
const plainLines = (...texts: string[]): Line[] =>
  texts.map((text, idx) => lineOf(idx, text === '' ? [] : [[text, false]]))

const demoLines: Line[] = [
  lineOf(0, [
    ['Села', false],
    ['Борщаговки', false],
    ['крестьянинъ', false],
  ]),
  lineOf(1, [
    ['Марія', false],
    ['Григоріева', true],
  ]),
]

const draft: CitedTranscription = { status: 'draft', lines: demoLines }
const verified = (extra: Partial<Transcription> = {}): CitedTranscription => ({
  status: 'verified',
  lines: demoLines,
  verifiedAt: '2026-11-14T10:00:00.000Z',
  ...extra,
})

const cite = (
  shelfmark: Shelfmark,
  format: 'dstu' | 'markdown' | 'text',
  transcription?: CitedTranscription,
) =>
  formatCitation({
    shelfmark,
    transcription: transcription ?? draft,
    format,
    withTranscription: transcription !== undefined,
    accessedAt,
  })

const attribution = 'Транскрипція: Хроніст (khronist.org).'
const licence = 'Транскрипція: Хроніст (khronist.org), CC BY 4.0.'
const draftNote = `${attribution} Чернетка, не підтверджена людиною. [?] — непевне прочитання.`

describe('formatCitation without the transcription', () => {
  it.each<[string, Shelfmark, 'dstu' | 'markdown' | 'text', string]>([
    [
      'dstu with a folio and the portal link',
      withFolio,
      'dstu',
      `ЦДІАК України. Ф. 127. Оп. 1078. Спр. 177. Арк. 14зв. URL: ${portalUrl} (дата звернення: 17.11.2026).`,
    ],
    [
      'dstu with an image only',
      imageOnly,
      'dstu',
      'ЦДІАК України. Ф. 127. Оп. 1078. Спр. 177. Зобр. 4.',
    ],
    [
      'dstu without doubled dots after abbreviations',
      {
        archive: 'Держ. архів Харків. обл.',
        fond: 'Р-4488',
        opys: '1',
        sprava: '1',
        folio: '64 зв.',
      },
      'dstu',
      'Держ. архів Харків. обл. Ф. Р-4488. Оп. 1. Спр. 1. Арк. 64 зв.',
    ],
    [
      'dstu without a period after a question mark, an exclamation mark or an ellipsis',
      { archive: 'Архів?', fond: '1!', opys: '2…', sprava: '3', folio: '4' },
      'dstu',
      'Архів? Ф. 1! Оп. 2… Спр. 3. Арк. 4.',
    ],
    [
      'text with a folio and the portal link',
      withFolio,
      'text',
      `ЦДІАК України, ф. 127, оп. 1078, спр. 177, арк. 14зв\n${portalUrl}`,
    ],
    [
      'text with an image only',
      imageOnly,
      'text',
      'ЦДІАК України, ф. 127, оп. 1078, спр. 177, зобр. 4',
    ],
    [
      'markdown with a folio links to the portal',
      withFolio,
      'markdown',
      `[ЦДІАК України, ф. 127, оп. 1078, спр. 177, арк. 14зв](${portalUrl})`,
    ],
    [
      'markdown with an image only',
      imageOnly,
      'markdown',
      'ЦДІАК України, ф. 127, оп. 1078, спр. 177, зобр. 4',
    ],
    [
      'markdown escapes the shelfmark',
      { archive: 'Архів [*тест*]', fond: '1_2', opys: '<3>', sprava: '4', image: 1 },
      'markdown',
      'Архів \\[\\*тест\\*\\], ф. 1\\_2, оп. \\<3\\>, спр. 4, зобр. 1',
    ],
    [
      'markdown keeps brackets in the link target from closing it',
      { ...imageOnly, portalUrl: 'https://example.org/scan(4)?a=1 b' },
      'markdown',
      '[ЦДІАК України, ф. 127, оп. 1078, спр. 177, зобр. 4](https://example.org/scan%284%29?a=1%20b)',
    ],
    [
      'markdown keeps a backslash in the link target from escaping the closing bracket',
      { ...imageOnly, portalUrl: 'https://example.org/scan?a=\\#f\\' },
      'markdown',
      '[ЦДІАК України, ф. 127, оп. 1078, спр. 177, зобр. 4](https://example.org/scan?a=%5C#f%5C)',
    ],
  ])('formats %s', (_case, shelfmark, format, expected) => {
    expect(cite(shelfmark, format)).toBe(expected)
  })

  it('dates the access by the Kyiv calendar day', () => {
    const text = formatCitation({
      shelfmark: withFolio,
      transcription: draft,
      format: 'dstu',
      withTranscription: false,
      accessedAt: new Date('2026-11-16T22:30:00.000Z'),
    })
    expect(text).toContain('(дата звернення: 17.11.2026).')
  })
})

describe('formatCitation with the transcription', () => {
  it('marks a draft and its uncertain words in dstu', () => {
    expect(cite(imageOnly, 'dstu', draft)).toBe(
      [
        'ЦДІАК України. Ф. 127. Оп. 1078. Спр. 177. Зобр. 4.',
        'Села Борщаговки крестьянинъ\nМарія Григоріева [?]',
        draftNote,
      ].join('\n\n'),
    )
  })

  it('marks a draft in plain text', () => {
    expect(cite(withFolio, 'text', draft)).toBe(
      [
        `ЦДІАК України, ф. 127, оп. 1078, спр. 177, арк. 14зв\n${portalUrl}`,
        'Села Борщаговки крестьянинъ\nМарія Григоріева [?]',
        draftNote,
      ].join('\n\n'),
    )
  })

  it('quotes a draft in markdown with line breaks and escaped markers', () => {
    expect(cite(imageOnly, 'markdown', draft)).toBe(
      [
        'ЦДІАК України, ф. 127, оп. 1078, спр. 177, зобр. 4',
        '> Села Борщаговки крестьянинъ\\\n> Марія Григоріева \\[?\\]',
        `${attribution} Чернетка, не підтверджена людиною. \\[?\\] — непевне прочитання.`,
      ].join('\n\n'),
    )
  })

  it('names a draft without uncertain words without the marker legend', () => {
    const text = cite(imageOnly, 'text', { status: 'draft', lines: plainLines('Села Борщаговки') })
    expect(text.endsWith(`${attribution} Чернетка, не підтверджена людиною.`)).toBe(true)
  })

  it('names a disputed version', () => {
    const text = cite(imageOnly, 'text', { status: 'disputed', lines: plainLines('Села') })
    expect(text.endsWith(`${attribution} Спірна версія, не підтверджена.`)).toBe(true)
  })

  it.each<[CitedTranscription['status']]>([['draft'], ['disputed']])(
    'gives no Commons licence to a %s version',
    (status) => {
      expect(cite(imageOnly, 'text', { status, lines: plainLines('Села') })).not.toContain('CC BY')
    },
  )

  it.each<['dstu' | 'markdown' | 'text']>([['dstu'], ['markdown'], ['text']])(
    'leaves out a transcription without text in %s',
    (format) => {
      const blank = { status: 'verified' as const, lines: plainLines('', '  \t ') }
      expect(cite(imageOnly, format, blank)).toBe(cite(imageOnly, format))
    },
  )

  it.each<['dstu' | 'markdown' | 'text', string]>([
    ['dstu', 'Села Борщаговки\nкрестьянинъ'],
    ['text', 'Села Борщаговки\nкрестьянинъ'],
    ['markdown', '> Села Борщаговки\\\n> крестьянинъ'],
  ])('collapses spaces, tabs and stray line breaks of a line in %s', (format, block) => {
    const lines = plainLines('  Села\t\tБорщаговки \n', ' крестьянинъ ')
    expect(cite(imageOnly, format, { status: 'verified', lines }).split('\n\n')[1]).toBe(block)
  })

  it('collapses the spacing of a draft line rebuilt from its words', () => {
    const line = {
      ...lineOf(0, [
        ['Марія', false],
        ['Григоріева\n', true],
      ]),
      text: 'Марія Григоріева',
    }
    expect(cite(imageOnly, 'text', { status: 'draft', lines: [line] }).split('\n\n')[1]).toBe(
      'Марія Григоріева [?]',
    )
  })

  it.each<[string, Partial<Transcription>, string]>([
    [
      'the account name with the signature',
      { verifiedBy: { name: 'Олена К.' }, verifiedSignature: 'О. Коваль, ЦДІАК' },
      'Підтверджено: Олена К. («О. Коваль, ЦДІАК»), 14.11.2026.',
    ],
    [
      'the account name alone',
      { verifiedBy: { name: 'Олена К.' } },
      'Підтверджено: Олена К., 14.11.2026.',
    ],
    [
      'the signature of an account without a name',
      { verifiedBy: { name: '' }, verifiedSignature: 'О. Коваль' },
      'Підтверджено: «О. Коваль», 14.11.2026.',
    ],
    [
      'the account name sent as the signature, once',
      { verifiedBy: { name: 'Олена К.' }, verifiedSignature: 'Олена К.' },
      'Підтверджено: Олена К., 14.11.2026.',
    ],
    [
      'the signature of a deleted account',
      { verifiedSignature: 'О. Коваль' },
      'Підтверджено: «О. Коваль», 14.11.2026.',
    ],
    ['nobody known', {}, 'Підтверджено, 14.11.2026.'],
    [
      'the Kyiv day of a late evening confirmation',
      { verifiedAt: '2026-11-13T22:30:00.000Z' },
      'Підтверджено, 14.11.2026.',
    ],
  ])('names a verified version by %s without uncertainty markers', (_case, extra, note) => {
    expect(cite(imageOnly, 'dstu', verified(extra))).toBe(
      [
        'ЦДІАК України. Ф. 127. Оп. 1078. Спр. 177. Зобр. 4.',
        'Села Борщаговки крестьянинъ\nМарія Григоріева',
        `${licence} ${note}`,
      ].join('\n\n'),
    )
  })

  it('escapes the verifier in markdown', () => {
    const text = cite(
      imageOnly,
      'markdown',
      verified({ verifiedBy: { name: '_Олена_' }, verifiedSignature: '*О. Коваль*' }),
    )
    expect(text.endsWith('Підтверджено: \\_Олена\\_ («\\*О. Коваль\\*»), 14.11.2026.')).toBe(true)
  })

  it.each<[string, string, string]>([
    ['Cyrillic with old letters', 'Іоаннъ исповѣданія ѳ ѵ', '> Іоаннъ исповѣданія ѳ ѵ'],
    ['emphasis', '*жирне* _курсив_', '> \\*жирне\\* \\_курсив\\_'],
    ['an illegible mark', 'Петровъ [нрзб]', '> Петровъ \\[нрзб\\]'],
    ['a year that would start a list', '1884. года', '> 1884\\. года'],
    ['a number with a bracket', '12) пункт', '> 12\\) пункт'],
    ['a year without a dot', '1884 года', '> 1884 года'],
    ['a dash that would start a list', '- пункт', '> \\- пункт'],
    ['a plus that would start a list', '+ пункт', '> \\+ пункт'],
    ['a heading underline', '===', '> \\==='],
    ['html', '<b>Іоаннъ</b>', '> \\<b\\>Іоаннъ\\</b\\>'],
    ['code, headings, tables and entities', '`к` # 5 | ~ &amp;', '> \\`к\\` \\# 5 \\| \\~ \\&amp;'],
    ['a backslash', 'C:\\шлях', '> C:\\\\шлях'],
    ['spacing and tabs', '  Села\tБорщаговки  ', '> Села Борщаговки'],
  ])('escapes %s in a markdown quote', (_case, line, quoted) => {
    const text = cite(imageOnly, 'markdown', { status: 'verified', lines: plainLines(line) })
    expect(text.split('\n\n')[1]).toBe(quoted)
  })

  it('breaks markdown quote lines only between non-empty lines', () => {
    const text = cite(imageOnly, 'markdown', {
      status: 'verified',
      lines: plainLines('перший', 'другий', '', 'третій'),
    })
    expect(text.split('\n\n')[1]).toBe('> перший\\\n> другий\n>\n> третій')
  })

  it.each<['dstu' | 'markdown' | 'text', string]>([
    ['text', 'перший\n\nдругий'],
    ['dstu', 'перший\n\nдругий'],
    ['markdown', '> перший\n>\n> другий'],
  ])('drops blank lines at both ends of the transcription in %s', (format, block) => {
    const lines = plainLines('', ' ', 'перший', '', 'другий', '\t', '')
    expect(cite(imageOnly, format, { status: 'verified', lines })).toBe(
      [cite(imageOnly, format), block, `${licence} Підтверджено.`].join('\n\n'),
    )
  })
})
