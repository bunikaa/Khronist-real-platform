import { sql } from 'drizzle-orm'
import { buildApp } from './app.ts'
import { describeProviders, loadConfig, type Config } from './config.ts'
import { createDatabase } from './db/client.ts'

const readConfig = (): Config => {
  try {
    return loadConfig()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

const config = readConfig()
const { db, client } = createDatabase(config.DATABASE_URL)

const app = await buildApp({
  logLevel: config.LOG_LEVEL,
  providers: describeProviders(config),
  checkDb: async () => {
    await db.execute(sql`select 1`)
    return true
  },
})

let closing = false

const shutdown = async (signal: string) => {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
    await client.end({ timeout: 5 })
    process.exit(0)
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port: config.PORT, host: config.HOST })
} catch (error) {
  app.log.error(error)
  await client.end({ timeout: 1 }).catch(() => undefined)
  process.exit(1)
}
