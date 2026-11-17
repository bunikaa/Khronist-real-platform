import { describe, expect, it } from 'vitest'
import { significantWords } from '../src/search/words.ts'

describe('significantWords', () => {
  it.each([
    ['Коваленко', ['коваленко']],
    ['  Іван   КОВАЛЕНКО ', ['іван', 'коваленко']],
    ['Ковале́нко', ['коваленко']],
    ['Йосип'.normalize('NFD'), ['йосип']],
    ['Мар‘яна', ["мар'яна"]],
    ['Мар’яна Марʼяна', ["мар'яна", "мар'яна"]],
    ["'Коваленко'", ['коваленко']],
    ['Коваленко-Петров', ['коваленко-петров']],
    ['-Борщагівка-', ['борщагівка']],
    ['від Коваленка', ['коваленка']],
    ['Коваленко 1905 року', ['коваленко']],
    ['XIX ХІХ Іван', ['іван']],
    ['12-го Івана', ['івана']],
    ['с. Гатне', ['гатне']],
    ['Ми', []],
    ['1905', []],
    ['від або для', []],
    ['м’я', ["м'я"]],
  ])('reads «%s» as %j', (query, words) => {
    expect(significantWords(query)).toEqual(words)
  })

  it('reads at most 40 tokens, as the server does', () => {
    const query = [...Array.from({ length: 40 }, () => 'від'), 'Коваленко'].join(' ')
    expect(significantWords(query)).toEqual([])
  })
})
