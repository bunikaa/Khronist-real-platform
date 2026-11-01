import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.ts'
import { createDatabase } from './client.ts'

export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))

export const runMigrations = async (url: string) => {
  const { db, client } = createDatabase(url)
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await client.end()
  }
}

if (import.meta.main) {
  const config = loadConfig()
  await runMigrations(config.DATABASE_URL)
  console.log('migrations applied')
}
