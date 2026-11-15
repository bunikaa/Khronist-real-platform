import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCallBudget } from '../src/services/budget.ts'
import { createTestDatabase, type TestDatabase } from './helpers.ts'

describe('daily model call budget', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database.client.close()
  })

  it('spends calls up to the limit, also when they arrive together, and then refuses', async () => {
    const budget = createCallBudget(database.db, 5)
    expect(await budget.available()).toBe(true)
    const spent = await Promise.all(Array.from({ length: 8 }, () => budget.spend()))
    expect(spent.filter(Boolean)).toHaveLength(5)
    expect(await budget.spend()).toBe(false)
    expect(await budget.available()).toBe(false)
  })
})
