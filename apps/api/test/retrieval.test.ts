import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chunks, sources, synonyms } from '../src/db/schema.ts'
import {
  conceptsOf,
  phrasesOf,
  queryWords,
  retrieve,
  searchText,
  type RetrievalQuery,
} from '../src/services/retrieval.ts'
import { createTestDatabase, resetDatabase, type TestDatabase } from './helpers.ts'

describe('queryWords', () => {
  it.each([
    ['Восприемник', ['восприемник']],
    ['12 генваря 1884', ['12', 'генваря', '1884']],
    ['с. Борщаговка, Кіевскаго у.', ['с', 'борщаговка', 'кіевскаго', 'у']],
    ["'Борщаговка' і ‘Іоаннъ’", ['борщаговка', 'і', 'іоаннъ']],
    ['п’ятниця, Киево-Печерская лавра', ["п'ятниця", 'киево-печерская', 'лавра']],
    ['тимчасовозобовʼязані', ["тимчасовозобов'язані"]],
    ['Борща-\nговка', ['борщаговка']],
    ['сло\u0301во', ['слово']],
    ['и\u0306ого', ['його']],
    ['  ', []],
  ])('splits %j', (text, words) => {
    expect(queryWords(text)).toEqual(words)
  })

  it('keeps at most 40 words of a long question', () => {
    expect(queryWords('слово '.repeat(100))).toHaveLength(40)
  })
})

describe('phrasesOf', () => {
  it.each([
    [[], []],
    [
      ['а', 'б'],
      ['а', 'а б', 'б'],
    ],
  ])('lists the runs of %j', (words, phrases) => {
    expect(phrasesOf(words)).toEqual(phrases)
  })

  it('lists every run of up to four words', () => {
    expect(phrasesOf(['а', 'б', 'в', 'г', 'д'])).toEqual([
      'а',
      'а б',
      'а б в',
      'а б в г',
      'б',
      'б в',
      'б в г',
      'б в г д',
      'в',
      'в г',
      'в г д',
      'г',
      'г д',
      'д',
    ])
  })
})

describe('conceptsOf', () => {
  const rows = [
    { term: 'Іоаннъ', variant: 'Иоанн' },
    { term: 'Іоаннъ', variant: 'Іван' },
    { term: 'Михайловская Борщаговка', variant: 'Михайлівська Борщагівка' },
    { term: 'Михайловская Борщаговка', variant: 'Михайловской Борщаговки' },
  ]

  it.each([
    ['a word of the dictionary', ['иоанн'], [['иоанн', 'іван', 'іоаннъ']]],
    ['a term itself', ['іоаннъ'], [['іоаннъ', 'иоанн', 'іван']]],
    [
      'a spelling of two words',
      ['михайлівська', 'борщагівка'],
      [['михайлівська борщагівка', 'михайловская борщаговка', 'михайловской борщаговки']],
    ],
    [
      'the longest spelling first',
      ['село', 'михайловской', 'борщаговки', 'іван'],
      [
        ['село'],
        ['михайловской борщаговки', 'михайловская борщаговка', 'михайлівська борщагівка'],
        ['іван', 'иоанн', 'іоаннъ'],
      ],
    ],
    ['a word outside the dictionary as itself', ['восприемник'], [['восприемник']]],
    [
      'no common words, short words or numbers',
      ['що', 'таке', 'автомобіль', 'або', 'на', '1884', 'хто', 'такий', 'наполеон'],
      [['автомобіль'], ['наполеон']],
    ],
    ['nothing without rows or words', [], []],
    ['no polite or generic words of a chat', ['дякую', 'далі', 'слово', 'року', 'столітті'], []],
    ['a repeated word once', ['іван', 'іоаннъ', 'іван'], [['іван', 'иоанн', 'іоаннъ']]],
    [
      'no Roman numerals or words with digits',
      ['xix', 'хіх', '1884-1885', '12-го', 'автомобіль'],
      [['автомобіль']],
    ],
  ])('takes %s', (_case, words, concepts) => {
    expect(conceptsOf(words, rows)).toEqual(concepts)
  })

  it('knows a term whose spellings differ only in case or a final dot', () => {
    expect(
      conceptsOf(
        ['про', 'свящ'],
        [
          { term: 'Про', variant: 'про' },
          { term: 'священник', variant: 'свящ.' },
        ],
      ),
    ).toEqual([['про'], ['свящ', 'священник']])
  })

  it('keeps at most twelve concepts', () => {
    const words = Array.from({ length: 20 }, (_, index) => `слово${'ж'.repeat(index + 1)}`)
    expect(conceptsOf(words, [])).toHaveLength(12)
  })
})

describe('searchText', () => {
  it.each([
    [['іоаннъ', 'киевский уезд'], 'іоаннъ or "киевский уезд"'],
    [['"-іван', "-ять'"], 'іван or ять'],
    [['or', 'іван'], 'іван'],
    [['', '"'], ''],
  ])('turns %j into %j', (spellings, text) => {
    expect(searchText(spellings)).toBe(text)
  })
})

describe('retrieve', () => {
  let database: TestDatabase
  const minRank = 0.05

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database.client.close()
  })

  const source = async (title: string, url: string) => {
    const [row] = await database.db
      .insert(sources)
      .values({
        title,
        url,
        licence: 'CC BY-SA 4.0',
        kind: 'encyclopedia',
        periodFrom: 17,
        periodTo: 20,
      })
      .returning({ id: sources.id })
    if (!row) throw new Error('no source')
    return row.id
  }

  type Article = {
    key: string
    topic: string
    text: string
    type: 'term' | 'place' | 'date'
    periodFrom?: number
    periodTo?: number
  }

  const add = async (sourceId: string, articles: Article[]) => {
    await database.db.insert(chunks).values(
      articles.map((article) => ({
        sourceId,
        articleKey: article.key,
        idx: 0,
        topic: article.topic,
        text: article.text,
        type: article.type,
        periodFrom: article.periodFrom ?? 18,
        periodTo: article.periodTo ?? 19,
      })),
    )
  }

  const topics = async (query: RetrievalQuery) =>
    (await retrieve(database.db, query, minRank)).chunks.map((chunk) => chunk.topic)

  beforeEach(async () => {
    await resetDatabase(database)
    const encyclopedia = await source('Енциклопедія історії України', 'https://example.org/eiu')
    await add(encyclopedia, [
      {
        key: 'vospriemnik',
        topic: 'Восприемник',
        text: 'Восприемник — хрещений батько або хрещена мати, записані в метричній книзі при хрещенні.',
        type: 'term',
      },
      {
        key: 'vospriemnik-old',
        topic: 'Восприемник',
        text: 'Восприемник у записах XVII ст. — свідок хрещення від громади.',
        type: 'term',
        periodFrom: 17,
        periodTo: 17,
      },
      {
        key: 'borshchahivka',
        topic: 'Борщагівка',
        text: 'Борщагівка — село Київського повіту, нині в межах Києва.',
        type: 'place',
        periodFrom: 17,
        periodTo: 20,
      },
      {
        key: 'mykhailivska',
        topic: 'Михайлівська Борщагівка',
        text: 'Михайловская Борщаговка — село під Києвом, окреме від Братської Борщагівки.',
        type: 'place',
        periodFrom: 17,
        periodTo: 20,
      },
      {
        key: 'julian',
        topic: 'Юліанський календар',
        text: 'Юліанський календар у XIX ст. відставав від григоріанського на 12 днів.',
        type: 'date',
        periodFrom: 19,
        periodTo: 20,
      },
    ])
    await database.db.insert(synonyms).values([
      { term: 'Восприемник', variant: 'воспріемникъ', type: 'term' },
      { term: 'Борщагівка', variant: 'Борщаговка', type: 'place' },
      {
        term: 'Михайловская Борщаговка',
        variant: 'Михайлівська Борщагівка',
        type: 'place',
      },
    ])
  })

  it('finds an article by a spelling from the dictionary and trusts a strong match', async () => {
    const found = await retrieve(database.db, { text: 'воспріемникъ' }, minRank)
    expect(found.chunks.map((chunk) => chunk.topic)).toEqual(['Восприемник', 'Восприемник'])
    expect(found.confident).toBe(true)
    expect(found.chunks[0]).toMatchObject({
      title: 'Енциклопедія історії України',
      url: 'https://example.org/eiu',
      licence: 'CC BY-SA 4.0',
      kind: 'encyclopedia',
      type: 'term',
    })
    expect(found.chunks[0]?.rank).toBeGreaterThanOrEqual(minRank)
  })

  it('finds an article by a spelling of several words and puts it first', async () => {
    const found = await retrieve(database.db, { text: 'Михайлівська Борщагівка' }, minRank)
    expect(found.chunks[0]?.topic).toBe('Михайлівська Борщагівка')
    expect(found.confident).toBe(true)
  })

  it('puts the article about a term above one that only mentions it often', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    await add(dictionary, [
      {
        key: 'prycht',
        topic: 'Причт',
        text: 'Причт: священник, восприемник, восприемник, восприемник при хрещенні.',
        type: 'term',
      },
    ])
    expect((await topics({ text: 'восприемник', period: '19' }))[0]).toBe('Восприемник')
  })

  it('puts the article that answers more of the question first', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    await add(dictionary, [
      { key: 'one', topic: 'Стаття перша', text: 'Сажень і більше нічого.', type: 'term' },
      { key: 'two', topic: 'Стаття друга', text: 'Сажень і верста поруч.', type: 'term' },
    ])
    expect((await topics({ text: 'верста сажень' }))[0]).toBe('Стаття друга')
  })

  it('orders chunks of the same rank by their id', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    const ids = ['3', '2', '1'].map((n) => `00000000-0000-7000-8000-00000000000${n}`)
    await database.db.insert(chunks).values(
      ids.map((id) => ({
        id,
        sourceId: dictionary,
        articleKey: `same-${id}`,
        idx: 0,
        topic: 'Однакова стаття',
        text: 'Верста як міра довжини.',
        type: 'term' as const,
        periodFrom: 18,
        periodTo: 19,
      })),
    )
    const found = await retrieve(database.db, { text: 'верста' }, minRank)
    expect(found.chunks.map((chunk) => chunk.id)).toEqual([...ids].reverse())
  })

  it('keeps the rank of a match however many spellings the dictionary has', async () => {
    const plain = await retrieve(database.db, { text: 'восприемник', period: '19' }, minRank)
    await database.db.insert(synonyms).values(
      ['восприємник', 'воспреемник', 'восприимник', 'восприемникъ'].map((variant) => ({
        term: 'Восприемник',
        variant,
        type: 'term',
      })),
    )
    const rich = await retrieve(database.db, { text: 'восприемник', period: '19' }, minRank)
    expect(rich.chunks[0]?.rank).toBe(plain.chunks[0]?.rank)
    expect(rich.confident).toBe(true)
  })

  it.each([
    ['що таке автомобіль на XIX ст.?'],
    ['хто такий Наполеон і що було на 12 день'],
    ['автомобіль або літак'],
  ])('does not trust common words in %j', async (text) => {
    expect((await retrieve(database.db, { text }, minRank)).confident).toBe(false)
  })

  it('finds a quoted word like a plain one', async () => {
    expect(await topics({ text: "'Борщаговка'", type: 'place' })).toEqual([
      'Борщагівка',
      'Михайлівська Борщагівка',
    ])
  })

  it('keeps only the articles of the century asked, or all without a century', async () => {
    const texts = async (period: '17' | '19') =>
      (await retrieve(database.db, { text: 'восприемник', period }, minRank)).chunks.map(
        (chunk) => chunk.text,
      )
    expect(await texts('19')).toEqual([expect.stringContaining('метричній книзі')])
    expect(await texts('17')).toEqual([expect.stringContaining('XVII ст.')])
    expect(await topics({ text: 'восприемник' })).toHaveLength(2)
  })

  it('keeps only the articles of the type asked', async () => {
    expect(await topics({ text: 'Борщаговка', type: 'place' })).toEqual([
      'Борщагівка',
      'Михайлівська Борщагівка',
    ])
    expect(await topics({ text: 'Борщаговка', type: 'term' })).toEqual([])
  })

  it('finds a word form missing from the dictionary by trigrams without trusting it', async () => {
    const found = await retrieve(database.db, { text: 'що таке Юліанського' }, minRank)
    expect(found.chunks.map((chunk) => [chunk.topic, chunk.rank])).toEqual([
      ['Юліанський календар', 0],
    ])
    expect(found.confident).toBe(false)
  })

  it('keeps the type filter on the trigram search', async () => {
    expect(await topics({ text: 'Юліанського', type: 'term' })).toEqual([])
    expect(await topics({ text: 'Юліанського', type: 'date' })).toEqual(['Юліанський календар'])
  })

  it('finds a word typed with another apostrophe or a dictionary abbreviation', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    await add(dictionary, [
      {
        key: 'tymchasovo',
        topic: "Тимчасовозобов'язані селяни",
        text: "Тимчасовозобов'язані селяни відбували повинності до викупу.",
        type: 'term',
      },
      { key: 'sviashchennyk', topic: 'Священник', text: 'Священник парафії.', type: 'term' },
    ])
    await database.db
      .insert(synonyms)
      .values([{ term: 'Священник', variant: 'свящ.', type: 'term' }])
    const apostrophe = await retrieve(database.db, { text: 'тимчасовозобовʼязані' }, minRank)
    expect(apostrophe.chunks[0]?.topic).toBe("Тимчасовозобов'язані селяни")
    expect(apostrophe.confident).toBe(true)
    const abbreviation = await retrieve(database.db, { text: 'свящ.' }, minRank)
    expect(abbreviation.chunks[0]?.topic).toBe('Священник')
    expect(abbreviation.confident).toBe(true)
  })

  it('looks up a dotted abbreviation only where the question has the dot', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    await add(dictionary, [
      {
        key: 'uezd',
        topic: 'Уезд',
        text: 'Уезд — адміністративна одиниця губернії.',
        type: 'term',
      },
      {
        key: 'kyivskyi',
        topic: 'Київський повіт',
        text: 'Київський повіт губернії.',
        type: 'place',
      },
    ])
    await database.db.insert(synonyms).values([
      { term: 'Уезд', variant: 'у.', type: 'term' },
      { term: 'Київський повіт', variant: 'Кіевскаго у.', type: 'place' },
    ])
    expect((await retrieve(database.db, { text: 'автомобіль у місті' }, minRank)).confident).toBe(
      false,
    )
    const abbreviation = await retrieve(database.db, { text: 'у.' }, minRank)
    expect(abbreviation.chunks[0]?.topic).toBe('Уезд')
    expect(abbreviation.confident).toBe(true)
    expect((await topics({ text: 'с. Борщаговка, Кіевскаго у.', type: 'place' }))[0]).toBe(
      'Київський повіт',
    )
  })

  it('puts the article about a phrase above one that repeats the phrase', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    await add(dictionary, [
      {
        key: 'selyany',
        topic: 'Селяни',
        text: 'Сільське товариство, сільське товариство і ще раз сільське товариство.',
        type: 'term',
      },
      { key: 'tovarystvo', topic: 'Сільське товариство', text: 'Громада селян.', type: 'term' },
    ])
    expect((await topics({ text: 'сільське товариство' }))[0]).toBe('Сільське товариство')
  })

  it('matches a corpus written with another apostrophe', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    await add(dictionary, [
      { key: 'piatnytsia', topic: 'Пʼятниця', text: 'Пʼятниця — день тижня.', type: 'date' },
      { key: 'tyzhden', topic: 'Тиждень', text: "П'ятниця, п'ятниця і субота.", type: 'date' },
    ])
    const found = await retrieve(database.db, { text: "п'ятниця" }, minRank)
    expect(found.chunks.map((chunk) => chunk.topic)).toEqual(['Пʼятниця', 'Тиждень'])
    expect(found.chunks[0]?.rank).toBeGreaterThan(1)
    expect(found.confident).toBe(true)
  })

  it('expands a word only with synonyms of the type asked', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    await add(dictionary, [
      { key: 'zghadka', topic: 'Згадка', text: 'Борщагівка згадується в описі.', type: 'term' },
    ])
    const found = await retrieve(database.db, { text: 'Борщаговка', type: 'term' }, minRank)
    expect(found.chunks.every((chunk) => chunk.rank === 0)).toBe(true)
    expect(found.confident).toBe(false)
  })

  it('finds nothing and trusts nothing for a word outside the corpus', async () => {
    expect(await retrieve(database.db, { text: 'автомобіль' }, minRank)).toEqual({
      chunks: [],
      confident: false,
    })
  })

  it('gives at most six chunks, the best first and ties in a stable order', async () => {
    const dictionary = await source('Словник', 'https://example.org/dictionary')
    await add(
      dictionary,
      Array.from({ length: 8 }, (_, index) => ({
        key: `kalendar-${index}`,
        topic: `Стаття ${index}`,
        text: `${'календар '.repeat(index + 1)}і більше нічого`,
        type: 'date' as const,
      })),
    )
    const first = await retrieve(database.db, { text: 'календар' }, minRank)
    expect(first.chunks).toHaveLength(6)
    expect(first.chunks[0]?.topic).toBe('Стаття 7')
    const ranks = first.chunks.map((chunk) => chunk.rank)
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
    expect(new Set(ranks).size).toBeGreaterThan(3)
    const again = await retrieve(database.db, { text: 'календар' }, minRank)
    expect(again.chunks.map((chunk) => chunk.id)).toEqual(first.chunks.map((chunk) => chunk.id))
  })
})
