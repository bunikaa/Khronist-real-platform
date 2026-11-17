import { strings } from '@khronist/ui'
import { describe, expect, it } from 'vitest'

describe('found', () => {
  it.each([
    [1, false, 'Знайдено 1 транскрипцію'],
    [2, false, 'Знайдено 2 транскрипції'],
    [5, false, 'Знайдено 5 транскрипцій'],
    [11, false, 'Знайдено 11 транскрипцій'],
    [21, false, 'Знайдено 21 транскрипцію'],
    [24, false, 'Знайдено 24 транскрипції'],
    [20, true, 'Показано 20 транскрипцій, є ще'],
  ])('counts %i results (more: %s)', (count, more, expected) => {
    expect(strings.web.found(count, more)).toBe(expected)
  })
})
