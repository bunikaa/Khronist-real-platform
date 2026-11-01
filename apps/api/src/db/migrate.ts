import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { loadDatabaseUrl } from '../config.ts'
import { createDatabase } from './client.ts'

export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))

const runMigrations = async (url: string) => {
  const { db, client } = createDatabase(url)
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await client.end()
  }
}

if (import.meta.main) {
  await runMigrations(loadDatabaseUrl())
  console.log('migrations applied')
}
