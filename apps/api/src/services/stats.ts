import type { AdminStatsResponse } from '@khronist/contracts'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { modelCalls, recognitions, regions, transcriptions } from '../db/schema.ts'
import { utcDay } from './budget.ts'

export const adminStats = async (
  db: Database,
  modelCallsPerDay: number,
): Promise<AdminStatsResponse> => {
  const readFromModel = sql`not (${recognitions.status} = 'done' and ${recognitions.startedAt} is null)`
  const [reads] = await db
    .select({
      total: sql<number>`count(*) filter (where ${readFromModel})`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${recognitions.status} = 'failed')`.mapWith(
        Number,
      ),
      p95Ms: sql<
        number | null
      >`percentile_cont(0.95) within group (order by extract(epoch from ${recognitions.finishedAt} - ${recognitions.createdAt}) * 1000) filter (where ${recognitions.status} = 'done' and ${recognitions.startedAt} is not null)`,
    })
    .from(recognitions)

  const [verified] = await db
    .select({ pages: sql<number>`count(distinct ${regions.pageId})`.mapWith(Number) })
    .from(transcriptions)
    .innerJoin(regions, eq(transcriptions.regionId, regions.id))
    .where(eq(transcriptions.status, 'verified'))

  const [calls] = await db
    .select({ calls: modelCalls.calls })
    .from(modelCalls)
    .where(eq(modelCalls.day, utcDay()))

  const p95 = reads?.p95Ms ?? null
  return {
    recognitions: {
      total: reads?.total ?? 0,
      failed: reads?.failed ?? 0,
      p95Ms: p95 === null ? null : Math.round(Number(p95)),
    },
    verifiedPages: verified?.pages ?? 0,
    modelCalls: { today: calls?.calls ?? 0, limit: modelCallsPerDay },
  }
}
