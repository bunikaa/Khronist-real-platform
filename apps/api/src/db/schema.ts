import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7())

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

const activeStatuses = sql`('queued', 'reading', 'normalizing')`

export const portalEnum = pgEnum('portal', ['archium', 'own'])
export const recognitionStatusEnum = pgEnum('recognition_status', [
  'queued',
  'reading',
  'normalizing',
  'done',
  'failed',
])
export const recognitionSourceEnum = pgEnum('recognition_source', [
  'extension',
  'web',
  'mcp',
  'batch',
])
export const transcriptionStatusEnum = pgEnum('transcription_status', [
  'draft',
  'verified',
  'disputed',
])
export const boxSourceEnum = pgEnum('box_source', ['model', 'estimated'])
export const entityTypeEnum = pgEnum('entity_type', ['person', 'place', 'term', 'date'])
export const sourceKindEnum = pgEnum('source_kind', [
  'dictionary',
  'encyclopedia',
  'wikidata',
  'publication',
])
export const chunkTypeEnum = pgEnum('chunk_type', ['term', 'place', 'date', 'unit', 'abbr'])

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

export const documents = pgTable(
  'documents',
  {
    id: id(),
    archive: text('archive').notNull(),
    fond: text('fond').notNull(),
    opys: text('opys').notNull(),
    sprava: text('sprava').notNull(),
    title: text('title'),
    portal: portalEnum('portal'),
    portalUrl: text('portal_url'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [unique('documents_shelfmark_unique').on(t.archive, t.fond, t.opys, t.sprava)],
)

export const pages = pgTable(
  'pages',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    folio: text('folio'),
    imageNo: integer('image_no'),
    sourceUrl: text('source_url'),
    imageHash: text('image_hash'),
    width: integer('width'),
    height: integer('height'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pages_document_folio_unique').on(t.documentId, t.folio),
    unique('pages_document_image_unique').on(t.documentId, t.imageNo),
    check('pages_folio_or_image', sql`${t.folio} is not null or ${t.imageNo} is not null`),
    check('pages_image_no_positive', sql`${t.imageNo} is null or ${t.imageNo} >= 1`),
  ],
)

export const regions = pgTable(
  'regions',
  {
    id: id(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'restrict' }),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    w: doublePrecision('w').notNull(),
    h: doublePrecision('h').notNull(),
    imageHash: text('image_hash').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('regions_image_hash_unique').on(t.imageHash),
    index('regions_page_idx').on(t.pageId),
    check(
      'regions_box',
      sql`${t.x} >= 0 and ${t.y} >= 0 and ${t.w} > 0 and ${t.h} > 0 and ${t.x} + ${t.w} <= 1.000001 and ${t.y} + ${t.h} <= 1.000001`,
    ),
  ],
)

export const transcriptions = pgTable(
  'transcriptions',
  {
    id: id(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    status: transcriptionStatusEnum('status').notNull().default('draft'),
    rawText: text('raw_text').notNull(),
    normalizedText: text('normalized_text').notNull().default(''),
    reader: text('reader').notNull(),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    verifiedBy: text('verified_by').references(() => user.id, { onDelete: 'set null' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('transcriptions_region_version_unique').on(t.regionId, t.version),
    index('transcriptions_fts_idx').using('gin', sql`to_tsvector('simple', ${t.normalizedText})`),
    check('transcriptions_version_positive', sql`${t.version} >= 1`),
    check(
      'transcriptions_verified_has_time',
      sql`${t.status} <> 'verified' or ${t.verifiedAt} is not null`,
    ),
  ],
)

export const recognitions = pgTable(
  'recognitions',
  {
    id: id(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    status: recognitionStatusEnum('status').notNull().default('queued'),
    source: recognitionSourceEnum('source').notNull(),
    transcriptionId: uuid('transcription_id').references(() => transcriptions.id, {
      onDelete: 'set null',
    }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('recognitions_active_status_idx').on(t.status).where(sql`${t.status} in ${activeStatuses}`),
    index('recognitions_region_idx').on(t.regionId),
    uniqueIndex('recognitions_one_active_per_region')
      .on(t.regionId)
      .where(sql`${t.status} in ${activeStatuses}`),
    check('recognitions_attempts_nonnegative', sql`${t.attempts} >= 0`),
  ],
)

export const transcriptionLines = pgTable(
  'transcription_lines',
  {
    id: id(),
    transcriptionId: uuid('transcription_id')
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    text: text('text').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    w: doublePrecision('w').notNull(),
    h: doublePrecision('h').notNull(),
    boxSource: boxSourceEnum('box_source').notNull(),
    confidence: real('confidence'),
  },
  (t) => [
    unique('transcription_lines_idx_unique').on(t.transcriptionId, t.idx),
    check(
      'transcription_lines_box',
      sql`${t.x} >= 0 and ${t.y} >= 0 and ${t.w} > 0 and ${t.h} > 0 and ${t.x} + ${t.w} <= 1.000001 and ${t.y} + ${t.h} <= 1.000001`,
    ),
    check(
      'transcription_lines_confidence',
      sql`${t.confidence} is null or ${t.confidence} between 0 and 1`,
    ),
  ],
)

export const lineWords = pgTable(
  'line_words',
  {
    id: id(),
    lineId: uuid('line_id')
      .notNull()
      .references(() => transcriptionLines.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    text: text('text').notNull(),
    uncertain: boolean('uncertain').notNull().default(false),
    confidence: real('confidence'),
  },
  (t) => [
    unique('line_words_idx_unique').on(t.lineId, t.idx),
    check('line_words_confidence', sql`${t.confidence} is null or ${t.confidence} between 0 and 1`),
  ],
)

export const entities = pgTable(
  'entities',
  {
    id: id(),
    transcriptionId: uuid('transcription_id')
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    type: entityTypeEnum('type').notNull(),
    text: text('text').notNull(),
    normalized: text('normalized'),
    wikidataId: text('wikidata_id'),
    startPos: integer('start_pos').notNull(),
    endPos: integer('end_pos').notNull(),
    extra: jsonb('extra'),
  },
  (t) => [
    index('entities_transcription_idx').on(t.transcriptionId),
    index('entities_normalized_trgm_idx').using('gin', t.normalized.op('gin_trgm_ops')),
    check('entities_span', sql`${t.startPos} >= 0 and ${t.endPos} > ${t.startPos}`),
  ],
)

export const edits = pgTable(
  'edits',
  {
    id: id(),
    transcriptionId: uuid('transcription_id')
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'restrict' }),
    lineIdx: integer('line_idx').notNull(),
    before: text('before').notNull(),
    after: text('after').notNull(),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('edits_transcription_idx').on(t.transcriptionId)],
)

export const sources = pgTable('sources', {
  id: id(),
  title: text('title').notNull(),
  url: text('url'),
  licence: text('licence').notNull(),
  kind: sourceKindEnum('kind').notNull(),
  period: text('period'),
})

export const chunks = pgTable(
  'chunks',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    textHash: text('text_hash').notNull(),
    topic: text('topic'),
    type: chunkTypeEnum('type').notNull(),
    period: text('period'),
    tsv: tsvector('tsv').notNull(),
  },
  (t) => [
    unique('chunks_source_hash_unique').on(t.sourceId, t.textHash),
    index('chunks_tsv_idx').using('gin', t.tsv),
    index('chunks_text_trgm_idx').using('gin', t.text.op('gin_trgm_ops')),
  ],
)

export const synonyms = pgTable(
  'synonyms',
  {
    id: id(),
    term: text('term').notNull(),
    variant: text('variant').notNull(),
    type: text('type').notNull(),
  },
  (t) => [
    unique('synonyms_term_variant_unique').on(t.term, t.variant),
    index('synonyms_variant_trgm_idx').using('gin', t.variant.op('gin_trgm_ops')),
  ],
)

export const notes = pgTable(
  'notes',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    transcriptionId: uuid('transcription_id').references(() => transcriptions.id, {
      onDelete: 'set null',
    }),
    excerpt: text('excerpt'),
    note: text('note'),
    citation: text('citation'),
    createdAt: createdAt(),
  },
  (t) => [index('notes_user_idx').on(t.userId)],
)

export const apiKeys = pgTable('api_keys', {
  id: id(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull().unique(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
})
