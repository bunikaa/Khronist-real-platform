import { sql } from 'drizzle-orm'
import { buildApp } from './app.ts'
import { createResendSender } from './auth/mail.ts'
import { llmStatus, loadConfig, signInSettings, type Config } from './config.ts'
import { createDatabase } from './db/client.ts'
import { createEventHub } from './jobs/events.ts'
import { createJobQueue } from './jobs/queue.ts'
import { failStaleRecognitions } from './jobs/recognize.ts'
import { closeOwnRecognitions } from './jobs/shutdown.ts'
import { defaultDrainMs, staleSweepMs } from './lib/limits.ts'
import { createCallBudget } from './services/budget.ts'
import { selectHtrReader } from './services/htr/index.ts'
import { noEntities, passthroughNormalizer } from './services/normalize.ts'

const closeMarginMs = 10_000

const readConfig = (): Config => {
  try {
    return loadConfig()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

const config = readConfig()
const drainMs =
  config.RAILWAY_DEPLOYMENT_DRAINING_SECONDS === undefined
    ? defaultDrainMs
    : Math.max(config.RAILWAY_DEPLOYMENT_DRAINING_SECONDS * 1000 - closeMarginMs, 1000)
const { db, client } = createDatabase(config.DATABASE_URL)
const budget = createCallBudget(db, config.MODEL_CALLS_PER_DAY)
const reader = selectHtrReader(config, budget)
const hub = createEventHub()
const queue = createJobQueue(config.JOBS_CONCURRENCY, (error) => app.log.error(error))
const signIn = signInSettings(config)
let closing = false

const app = await buildApp({
  logLevel: config.LOG_LEVEL,
  clientIpHeader: config.CLIENT_IP_HEADER,
  corsOrigins: config.CORS_ORIGINS,
  guestRecognitionsPerDay: config.GUEST_RECOGNITIONS_PER_DAY,
  isShuttingDown: () => closing,
  providers: { llm: llmStatus(config), htr: reader?.kind ?? 'down' },
  checkDb: async () => {
    await db.execute(sql`select 1`)
    return true
  },
  recognitions: {
    db,
    reader,
    normalizer: passthroughNormalizer,
    entities: noEntities,
    budget,
    hub,
    queue,
  },
  ...(signIn && {
    auth: {
      db,
      secret: signIn.secret,
      baseURL: signIn.baseURL,
      sendCode: createResendSender(signIn.resendApiKey, signIn.mailFrom),
    },
  }),
  ...(config.ADMIN_API_KEY !== undefined && {
    admin: { db, apiKey: config.ADMIN_API_KEY, modelCallsPerDay: config.MODEL_CALLS_PER_DAY },
  }),
})

try {
  const recovered = await failStaleRecognitions(db, { code: 'restarted' })
  if (recovered > 0) app.log.warn({ recovered }, 'marked stale recognitions as failed')
} catch (error) {
  app.log.error(error, 'could not recover stale recognitions')
  await client.end({ timeout: 1 }).catch(() => undefined)
  process.exit(1)
}

const sweep = setInterval(() => {
  failStaleRecognitions(db, { code: 'restarted' }).then(
    (closed) => {
      if (closed > 0) app.log.warn({ closed }, 'marked stale recognitions as failed')
    },
    (error: unknown) => app.log.error(error, 'could not close stale recognitions'),
  )
}, staleSweepMs)
sweep.unref()

const shutdown = async (signal: string) => {
  if (closing) process.exit(1)
  closing = true
  clearInterval(sweep)
  app.log.info({ signal, drainMs }, 'shutting down')
  setTimeout(() => process.exit(1), drainMs + closeMarginMs - 1000).unref()
  try {
    const closed = await closeOwnRecognitions({ db, hub, queue, drainMs })
    if (closed.dropped + closed.cut > 0) app.log.warn(closed, 'closed unfinished recognitions')
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
