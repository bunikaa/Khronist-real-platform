import { drizzle } from 'drizzle-orm/postgres-js'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import * as schema from './schema.ts'

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

export const createDatabase = (url: string) => {
  const client = postgres(url, { max: 10, connect_timeout: 5, onnotice: () => {} })
  const db = drizzle(client, { schema })
  return { db, client }
}
