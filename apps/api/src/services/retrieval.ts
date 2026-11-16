import type { Hints } from '@khronist/contracts'
import { and, eq, gte, inArray, lte, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { chunks, sources, synonyms } from '../db/schema.ts'

type ChunkType = (typeof chunks.type.enumValues)[number]

export type RetrievalQuery = {
  text: string
  type?: ChunkType | undefined
  period?: Hints['period'] | undefined
}

const maxChunks = 6
const maxTokens = 40
const maxPhraseWords = 4
const maxConcepts = 12
const maxSpellings = 12
const maxSimilarWords = 8
const topicBonus = 1

const combiningMarks = /\p{M}/gu
const apostrophes = /[’ʼ‘]/gu
const wrappedWord = /-\s*\n\s*/gu
const tokenPattern = /[\p{L}\p{N}'-]+\.?/gu
const edgeMarks = /^['-]+|['-]+$/gu
const searchSyntax = /[^\p{L}\p{N}'\s-]+/gu
const hasDigit = /\p{N}/u
const romanNumeral = /^(?:[ivxlcdm]+|[хіv]+)$/u

const stopWords = new Set([
  ...['або', 'але', 'без', 'біля', 'був', 'була', 'були', 'було', 'буде', 'бути', 'вже', 'від'],
  ...['вона', 'вони', 'воно', 'все', 'всі', 'для', 'його', 'йому', 'коли', 'крім', 'між', 'над'],
  ...['них', 'після', 'під', 'при', 'про', 'так', 'також', 'там', 'тут', 'тим', 'той', 'тому'],
  ...['хто', 'чого', 'чому', 'через', 'щоб', 'яка', 'які', 'який', 'яке', 'якщо', 'таке', 'такий'],
  ...['така', 'такі', 'розкажи', 'поясни', 'скажи', 'означає', 'цей', 'цього', 'ця', 'ці'],
  ...['якому', 'якій', 'якого', 'яких', 'скільки', 'дякую', 'далі', 'привіт', 'справи', 'будь'],
  ...['ласка', 'можна', 'слово', 'слова', 'значення', 'рік', 'року', 'році', 'століття'],
  ...['столітті', 'сторіччя', 'місяць', 'місяця'],
  ...['или', 'что', 'как', 'кто', 'где', 'когда', 'почему', 'это', 'этот', 'эта', 'эти', 'его'],
  ...['ему', 'она', 'они', 'оно', 'был', 'была', 'были', 'было', 'быть', 'под', 'через', 'после'],
  ...['также', 'такое', 'такой', 'который', 'которая', 'которые', 'если', 'чтобы', 'отъ', 'изъ'],
])

type Token = { word: string; dotted: boolean }

const tokensOf = (text: string): Token[] =>
  (
    text
      .normalize('NFC')
      .replace(combiningMarks, '')
      .replace(apostrophes, "'")
      .toLowerCase()
      .replace(wrappedWord, '')
      .match(tokenPattern) ?? []
  )
    .map((token) => ({
      word: token.replace(/\.$/u, '').replace(edgeMarks, ''),
      dotted: token.endsWith('.'),
    }))
    .filter(({ word }) => word.length > 0)
    .slice(0, maxTokens)

export const queryWords = (text: string): string[] => tokensOf(text).map(({ word }) => word)

const isContentWord = (word: string) =>
  word.length > 2 && !hasDigit.test(word) && !romanNumeral.test(word) && !stopWords.has(word)

export const phrasesOf = (words: string[]): string[] => {
  const phrases = new Set<string>()
  for (let start = 0; start < words.length; start += 1) {
    for (let size = 1; size <= maxPhraseWords && start + size <= words.length; size += 1) {
      phrases.add(words.slice(start, start + size).join(' '))
    }
  }
  return [...phrases]
}

const withApostrophes = (text: string) =>
  text.includes("'") ? [text, ...['’', 'ʼ', '‘'].map((mark) => text.replaceAll("'", mark))] : [text]

const lookupForms = (tokens: Token[]) => {
  const plain = phrasesOf(tokens.map(({ word }) => word))
  const dotted = phrasesOf(tokens.map(({ word, dotted }) => (dotted ? `${word}.` : word)))
  return [...new Set([...plain, ...dotted])].flatMap(withApostrophes)
}

type SynonymRow = { term: string; variant: string }

const spellingIndex = (rows: SynonymRow[]) => {
  const termsOf = new Map<string, Set<string>>()
  const spellingsOf = new Map<string, Set<string>>()
  for (const { term, variant } of rows) {
    for (const spelling of [queryWords(term).join(' '), queryWords(variant).join(' ')]) {
      if (spelling.length === 0) continue
      termsOf.set(spelling, (termsOf.get(spelling) ?? new Set()).add(term))
      spellingsOf.set(term, (spellingsOf.get(term) ?? new Set()).add(spelling))
    }
  }
  return (phrase: string) => {
    const terms = termsOf.get(phrase)
    if (!terms) return undefined
    const all = [...terms].flatMap((term) => [...(spellingsOf.get(term) ?? [])])
    const spellings = [phrase, ...[...new Set(all)].filter((s) => s !== phrase).sort()]
    return { key: [...terms].sort().join('|'), spellings: spellings.slice(0, maxSpellings) }
  }
}

type Known = ReturnType<typeof spellingIndex>

const longestKnown = (words: string[], start: number, known: Known) => {
  for (let size = Math.min(maxPhraseWords, words.length - start); size > 0; size -= 1) {
    const found = known(words.slice(start, start + size).join(' '))
    if (found) return { size, ...found }
  }
  return undefined
}

export const conceptsOf = (words: string[], rows: SynonymRow[]): string[][] => {
  const known = spellingIndex(rows)
  const concepts = new Map<string, string[]>()
  for (let start = 0; start < words.length && concepts.size < maxConcepts;) {
    const found = longestKnown(words, start, known)
    const word = words[start] ?? ''
    if (found) concepts.set(`term:${found.key}`, found.spellings)
    else if (isContentWord(word)) concepts.set(`word:${word}`, [word])
    start += found?.size ?? 1
  }
  return [...concepts.values()]
}

const asSearchTerm = (spelling: string) => {
  const words = spelling
    .replace(searchSyntax, ' ')
    .split(/\s+/u)
    .map((word) => word.replace(edgeMarks, ''))
    .filter((word) => word.length > 0)
  const clean = words.join(' ')
  if (clean.length === 0 || clean === 'or') return ''
  return words.length > 1 ? `"${clean}"` : clean
}

export const searchText = (spellings: string[]): string =>
  spellings
    .map(asSearchTerm)
    .filter((term) => term.length > 0)
    .join(' or ')

const synonymRows = async (db: Database, tokens: Token[], type: ChunkType | undefined) => {
  const forms = lookupForms(tokens)
  if (forms.length === 0) return []
  const typed = type ? eq(synonyms.type, type) : undefined
  const matched = db
    .select({ term: synonyms.term })
    .from(synonyms)
    .where(
      and(
        or(
          inArray(sql`lower(${synonyms.term})`, forms),
          inArray(sql`lower(${synonyms.variant})`, forms),
        ),
        typed,
      ),
    )
  return db
    .select({ term: synonyms.term, variant: synonyms.variant })
    .from(synonyms)
    .where(and(inArray(synonyms.term, matched), typed))
    .orderBy(synonyms.term, synonyms.variant)
}

const chunkFields = {
  id: chunks.id,
  sourceId: chunks.sourceId,
  title: sources.title,
  url: sources.url,
  licence: sources.licence,
  kind: sources.kind,
  topic: chunks.topic,
  text: chunks.text,
  type: chunks.type,
}

const scope = ({ type, period }: RetrievalQuery): SQL[] => {
  const century = period === undefined ? undefined : Number(period)
  return [
    ...(type ? [eq(chunks.type, type)] : []),
    ...(century === undefined
      ? []
      : [lte(chunks.periodFrom, century), gte(chunks.periodTo, century)]),
  ]
}

const canonicalTopic = sql`lower(translate(${chunks.topic}, '’ʼ‘', ${"'''"}))`

export type Concept = { spellings: string[]; terms: string[] }

export const expandQuery = async (db: Database, text: string, type?: ChunkType) => {
  const tokens = tokensOf(text)
  const words = tokens.map(({ word }) => word)
  const rows = await synonymRows(db, tokens, type)
  const concepts = conceptsOf(words, rows)
    .map((spellings) => ({
      spellings,
      terms: spellings.flatMap(withApostrophes).map(asSearchTerm).filter(Boolean),
    }))
    .filter(({ terms }) => terms.length > 0)
  return { words, concepts }
}

export const similarWordsOf = (words: string[]): string[] =>
  [...new Set(words.filter(isContentWord))].slice(0, maxSimilarWords)

export const anyConceptQuery = (concepts: Concept[]): SQL =>
  sql`websearch_to_tsquery('simple', ${searchText(
    concepts.flatMap(({ spellings }) => spellings.flatMap(withApostrophes)),
  )})`

export const conceptRank = (vector: SQLWrapper, terms: string[]): SQL =>
  sql`greatest(${sql.join(
    terms.map((term) => sql`ts_rank(${vector}, websearch_to_tsquery('simple', ${term}))`),
    sql`, `,
  )})`

const topicMatch = (titles: string[]) =>
  sql`case when ${canonicalTopic} in (${sql.join(
    titles.map((title) => sql`${title}`),
    sql`, `,
  )}) then ${sql.raw(String(topicBonus))} else 0 end`

const rankedChunks = (db: Database, concepts: Concept[], phrase: string, filters: SQL[]) => {
  if (concepts.length === 0) return Promise.resolve([])
  const tsquery = anyConceptQuery(concepts)
  const titles = [...new Set([phrase, ...concepts.flatMap(({ spellings }) => spellings)])]
  const parts = [...concepts.map(({ terms }) => conceptRank(chunks.tsv, terms)), topicMatch(titles)]
  const rank = sql<number>`${sql.join(parts, sql` + `)}`.as('rank')
  return db
    .select({ ...chunkFields, rank })
    .from(chunks)
    .innerJoin(sources, eq(sources.id, chunks.sourceId))
    .where(and(sql`${chunks.tsv} @@ ${tsquery}`, ...filters))
    .orderBy(sql`rank desc`, chunks.id)
    .limit(maxChunks)
}

const similarChunks = (db: Database, words: string[], filters: SQL[]) => {
  if (words.length === 0) return Promise.resolve([])
  const similarity = sql<number>`greatest(${sql.join(
    words.map((word) => sql`word_similarity(${word}, ${chunks.text})`),
    sql`, `,
  )})`.as('similarity')
  return db
    .select({ ...chunkFields, similarity })
    .from(chunks)
    .innerJoin(sources, eq(sources.id, chunks.sourceId))
    .where(and(or(...words.map((word) => sql`${word} <% ${chunks.text}`)), ...filters))
    .orderBy(sql`similarity desc`, chunks.id)
    .limit(maxChunks)
}

export const retrieve = async (db: Database, query: RetrievalQuery, minRank: number) => {
  const filters = scope(query)
  const [{ words, concepts }, similar] = await Promise.all([
    expandQuery(db, query.text, query.type),
    similarChunks(db, similarWordsOf(queryWords(query.text)), filters),
  ])
  const ranked = await rankedChunks(db, concepts, words.join(' '), filters)
  const known = new Set(ranked.map((chunk) => chunk.id))
  const extra = similar
    .filter((chunk) => !known.has(chunk.id))
    .map(({ similarity: _similarity, ...chunk }) => ({ ...chunk, rank: 0 }))
  return {
    chunks: [...ranked, ...extra].slice(0, maxChunks),
    confident: (ranked[0]?.rank ?? 0) >= minRank,
  }
}
