import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { modelCalls } from '../db/schema.ts'
import type { CallBudget } from './llm/index.ts'

export const utcDay = (): string => new Date().toISOString().slice(0, 10)

export const createCallBudget = (db: Database, callsPerDay: number): CallBudget => ({
  spend: async () => {
    const rows = await db
      .insert(modelCalls)
      .values({ day: utcDay(), calls: 1 })
      .onConflictDoUpdate({
        target: modelCalls.day,
        set: { calls: sql`${modelCalls.calls} + 1` },
        setWhere: sql`${modelCalls.calls} < ${callsPerDay}`,
      })
      .returning({ calls: modelCalls.calls })
    return rows.length > 0
  },
  available: async (share = 1) => {
    const [row] = await db
      .select({ calls: modelCalls.calls })
      .from(modelCalls)
      .where(eq(modelCalls.day, utcDay()))
    return (row?.calls ?? 0) < callsPerDay * share
  },
})
