import { comparableWord } from './words.ts'

type SnippetPart = { text: string; match: boolean }

const snippetWord = /[\p{L}\p{M}\p{N}]+(?:['’ʼ‘-]+[\p{L}\p{M}\p{N}]+)*/gu

const matches = (token: string, words: string[]) => {
  const word = comparableWord(token)
  const parts = [word, ...word.split('-')]
  return words.some((queryWord) => parts.includes(queryWord))
}

export const highlightSnippet = (snippet: string, words: string[]): SnippetPart[] => {
  const parts: SnippetPart[] = []
  let plainFrom = 0
  for (const found of snippet.matchAll(snippetWord)) {
    if (!matches(found[0], words)) continue
    if (found.index > plainFrom)
      parts.push({ text: snippet.slice(plainFrom, found.index), match: false })
    parts.push({ text: found[0], match: true })
    plainFrom = found.index + found[0].length
  }
  if (plainFrom < snippet.length) parts.push({ text: snippet.slice(plainFrom), match: false })
  return parts
}
