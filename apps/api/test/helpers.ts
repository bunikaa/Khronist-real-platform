import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { buildApp } from '../src/app.ts'
import { migrationsFolder } from '../src/db/migrate.ts'
import * as schema from '../src/db/schema.ts'
import { createEventHub } from '../src/jobs/events.ts'
import { createJobQueue } from '../src/jobs/queue.ts'
import type { JobLogger } from '../src/jobs/recognize.ts'
import { pngEnd } from '../src/lib/image.ts'
import { createFixtureReader } from '../src/services/htr/fixture.ts'
import type { HtrReader, ReadInput } from '../src/services/htr/index.ts'
import type { CallBudget } from '../src/services/llm/index.ts'
import { noEntities, type EntityExtractor } from '../src/services/entities.ts'
import type { Explainer } from '../src/services/explain.ts'
import { passthroughNormalizer, type Normalizer } from '../src/services/normalize.ts'

export const createTestDatabase = async () => {
  const client = new PGlite({ extensions: { pg_trgm } })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  return { db, client }
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>

export const resetDatabase = async ({ db }: TestDatabase) => {
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  )
  const names = tables.rows.map((row) => `"${row.tablename}"`).join(', ')
  await db.execute(sql.raw(`truncate table ${names} restart identity cascade`))
}

export const silentLog: JobLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
}

export const unlimitedBudget: CallBudget = {
  spend: async () => true,
  available: async () => true,
}

const dropHardSign = (text: string) => text.replace(/ъ(?=\s|$)/g, '')

export const dropHardSigns: Normalizer = {
  normalize: async ({ lines }) => ({
    lines: lines.map((line) => ({
      text: dropHardSign(line.text),
      words: line.words.map((word) => ({
        text: dropHardSign(word.text),
        uncertain: word.uncertain,
      })),
    })),
    expansions: [],
  }),
}

export const makePng = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  header[24] = 8
  header[25] = 2
  return Buffer.concat([header, pngEnd])
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export const recognitionBody = (png: Buffer, extra: Record<string, unknown> = {}) => ({
  image: { base64Png: png.toString('base64') },
  imageHash: sha256(png),
  source: 'extension',
  ...extra,
})

export type RecordingReader = {
  reader: HtrReader
  inputs: ReadInput[]
  release: () => void
}

export const createRecordingReader = (options: { gated?: boolean } = {}): RecordingReader => {
  let open: () => void = () => {}
  const opened = options.gated
    ? new Promise<void>((resolve) => {
        open = resolve
      })
    : Promise.resolve()
  const inner = createFixtureReader()
  const inputs: ReadInput[] = []
  return {
    reader: {
      ...inner,
      read: async (input) => {
        inputs.push(input)
        await opened
        return inner.read(input)
      },
    },
    inputs,
    release: () => open(),
  }
}

export const failingReader = (message: string): HtrReader => ({
  kind: 'fixture',
  read: async () => {
    throw new Error(message)
  },
})

export const emptyReader: HtrReader = {
  kind: 'fixture',
  read: async () => ({ lines: [], warnings: [], reader: 'empty' }),
}

export type TestAppOptions = {
  reader?: HtrReader | undefined
  normalizer?: Normalizer
  entities?: EntityExtractor
  explain?: Explainer
  guestExplainsPerDay?: number
  budget?: CallBudget
  isShuttingDown?: () => boolean
  readTimeoutMs?: number
  normalizeTimeoutMs?: number
  entitiesTimeoutMs?: number
  maxBacklog?: number
  staleAfterMs?: number
  maxStreamMs?: number
  heartbeatMs?: number
  clientIpHeader?: string
  corsOrigins?: string[]
  guestRecognitionsPerDay?: number
  apiKeyRecognitionsPerDay?: number
  adminApiKey?: string
  signIn?: { codes: Map<string, string>; verifierEmails?: string[] }
}

const authBaseURL = 'http://localhost:3000'

export const createTestApp = async (database: TestDatabase, options: TestAppOptions = {}) => {
  const hub = createEventHub()
  const queue = createJobQueue(2, () => {})
  const reader = 'reader' in options ? options.reader : createFixtureReader()
  const app = await buildApp({
    logLevel: 'silent',
    providers: { llm: 'ok', htr: 'fixture' },
    checkDb: async () => true,
    clientIpHeader: options.clientIpHeader,
    corsOrigins: options.corsOrigins,
    guestRecognitionsPerDay: options.guestRecognitionsPerDay,
    apiKeyRecognitionsPerDay: options.apiKeyRecognitionsPerDay,
    isShuttingDown: options.isShuttingDown,
    ...(options.explain && { explain: options.explain }),
    guestExplainsPerDay: options.guestExplainsPerDay,
    ...(options.adminApiKey !== undefined && {
      admin: { db: database.db, apiKey: options.adminApiKey, modelCallsPerDay: 2000 },
    }),
    ...(options.signIn && {
      auth: {
        db: database.db,
        secret: 's'.repeat(32),
        baseURL: authBaseURL,
        codesPerDay: 100,
        verifierEmails: options.signIn.verifierEmails ?? [],
        sendCode: async (to: string, code: string) => {
          options.signIn?.codes.set(to, code)
        },
      },
    }),
    recognitions: {
      db: database.db,
      reader,
      normalizer: options.normalizer ?? passthroughNormalizer,
      entities: options.entities ?? noEntities,
      budget: options.budget ?? unlimitedBudget,
      hub,
      queue,
      heartbeatMs: options.heartbeatMs ?? 20,
      readTimeoutMs: options.readTimeoutMs,
      normalizeTimeoutMs: options.normalizeTimeoutMs,
      entitiesTimeoutMs: options.entitiesTimeoutMs,
      maxBacklog: options.maxBacklog,
      staleAfterMs: options.staleAfterMs,
      maxStreamMs: options.maxStreamMs,
    },
  })
  return { app, hub, queue }
}

export const parseSse = (body: string): { event: string; data: unknown }[] =>
  body
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('event:'))
    .map((chunk) => {
      const lines = chunk.split('\n')
      const event =
        lines
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim() ?? ''
      const data =
        lines
          .find((l) => l.startsWith('data:'))
          ?.slice(5)
          .trim() ?? 'null'
      return { event, data: JSON.parse(data) as unknown }
    })

type InjectingApp = Awaited<ReturnType<typeof createTestApp>>['app']

export const signIn = async (
  app: InjectingApp,
  codes: Map<string, string>,
  email: string,
): Promise<string> => {
  codes.delete(email)
  const sent = await app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    payload: { email, type: 'sign-in' },
  })
  if (sent.statusCode !== 200) throw new Error(`the code was not sent: ${sent.statusCode}`)
  await waitUntil(() => codes.has(email))
  const signedIn = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email-otp',
    payload: { email, otp: codes.get(email) },
  })
  const token = signedIn.headers['set-auth-token']
  if (typeof token !== 'string') throw new Error(`sign-in failed: ${signedIn.statusCode}`)
  return token
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const waitUntil = async (condition: () => boolean, timeoutMs = 2000) => {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition was not met in time')
    await sleep(5)
  }
}
