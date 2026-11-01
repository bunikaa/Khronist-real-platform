import { sql } from 'drizzle-orm'
import { buildApp } from './app.ts'
import { llmStatus, loadConfig, type Config } from './config.ts'
import { createDatabase } from './db/client.ts'
import { createEventHub } from './jobs/events.ts'
import { createJobQueue } from './jobs/queue.ts'
import { recoverInterruptedRecognitions } from './jobs/recognize.ts'
import { selectHtrReader } from './services/htr/index.ts'
import { passthroughNormalizer } from './services/normalize.ts'

const drainTimeoutMs = 10_000
const exitTimeoutMs = 15_000

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
const reader = selectHtrReader(config, {
  onRead: (details) => app.log.info(details, 'fragment read'),
  onFailure: (details, message) => app.log.warn(details, message),
})
const hub = createEventHub()
const queue = createJobQueue(config.JOBS_CONCURRENCY, (error) => app.log.error(error))

const app = await buildApp({
  logLevel: config.LOG_LEVEL,
  trustProxy: config.TRUST_PROXY,
  providers: { llm: llmStatus(config), htr: reader?.kind ?? 'down' },
  checkDb: async () => {
    await db.execute(sql`select 1`)
    return true
  },
  recognitions: {
    db,
    reader,
    normalizer: passthroughNormalizer,
    hub,
    queue,
  },
})

try {
  const recovered = await recoverInterruptedRecognitions(db)
  if (recovered > 0) app.log.warn({ recovered }, 'marked interrupted recognitions as failed')
} catch (error) {
  app.log.error(error, 'could not recover interrupted recognitions')
  await client.end({ timeout: 1 }).catch(() => undefined)
  process.exit(1)
}

let closing = false

const shutdown = async (signal: string) => {
  if (closing) process.exit(1)
  closing = true
  app.log.info({ signal }, 'shutting down')
  setTimeout(() => process.exit(1), exitTimeoutMs).unref()
  try {
    await app.close()
    await Promise.race([queue.onIdle(), new Promise((resolve) => setTimeout(resolve, drainTimeoutMs))])
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
