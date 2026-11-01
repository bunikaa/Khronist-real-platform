import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

export const createDatabase = (url: string) => {
  const client = postgres(url, { max: 10, connect_timeout: 5, onnotice: () => {} })
  const db = drizzle(client, { schema })
  return { db, client }
}

export type Database = ReturnType<typeof createDatabase>['db']
