import {
  maxHistoryEdits,
  type Line,
  type PatchLinesRequest,
  type TranscriptionHistory,
  type VerifyRequest,
} from '@khronist/contracts'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { edits, pages, regions, transcriptions, user } from '../db/schema.ts'
import { ApiError } from '../lib/errors.ts'
import { insertTranscriptionVersion, loadLines, warningsOf } from './transcriptions.ts'

type Conflict = { kind: 'conflict'; currentId: string }
type EditOutcome = { kind: 'edited' | 'unchanged'; transcriptionId: string } | Conflict
type VerifyOutcome = { kind: 'verified'; transcriptionId: string } | Conflict

export const transcriptionNotFound = () =>
  new ApiError(404, 'not_found', 'Транскрипцію не знайдено')

export const editedLine = (line: Line, text: string): Line => ({
  ...line,
  text,
  uncertain: false,
  words: text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ text: word, uncertain: false })),
})

const lockVersion = async (tx: Database, transcriptionId: string) => {
  const [version] = await tx
    .select({
      id: transcriptions.id,
      regionId: transcriptions.regionId,
      version: transcriptions.version,
      status: transcriptions.status,
      reader: transcriptions.reader,
      warnings: transcriptions.warnings,
      pageId: regions.pageId,
    })
    .from(transcriptions)
    .innerJoin(regions, eq(regions.id, transcriptions.regionId))
    .where(eq(transcriptions.id, transcriptionId))
    .for('update', { of: transcriptions })
  if (!version) throw transcriptionNotFound()
  const [latest] = await tx
    .select({ id: transcriptions.id })
    .from(transcriptions)
    .where(eq(transcriptions.regionId, version.regionId))
    .orderBy(desc(transcriptions.version))
    .limit(1)
  return { version, latestId: latest?.id ?? version.id }
}

export const editLines = (
  db: Database,
  transcriptionId: string,
  request: PatchLinesRequest,
  authorId: string,
): Promise<EditOutcome> =>
  db.transaction(async (tx) => {
    const { version, latestId } = await lockVersion(tx, transcriptionId)
    if (latestId !== version.id || version.version !== request.baseVersion) {
      return { kind: 'conflict', currentId: latestId }
    }

    const lines = await loadLines(tx, version.id)
    const byIdx = new Map(lines.map((line) => [line.idx, line]))
    if (request.lines.some(({ idx }) => !byIdx.has(idx))) {
      throw new ApiError(400, 'bad_request', 'У цій версії немає рядка з таким номером')
    }
    const changes = request.lines.flatMap(({ idx, text }) => {
      const line = byIdx.get(idx)
      return line && line.text !== text ? [{ line, text }] : []
    })
    if (changes.length === 0) return { kind: 'unchanged', transcriptionId: version.id }

    const changed = new Map(changes.map(({ line, text }) => [line.idx, text]))
    const editedId = await insertTranscriptionVersion(tx, {
      regionId: version.regionId,
      reader: version.reader,
      lines: lines.map((line) => {
        const text = changed.get(line.idx)
        return text === undefined ? line : editedLine(line, text)
      }),
      warnings: warningsOf(version.warnings),
      normalized: null,
      translatedLines: null,
      entities: [],
      authorId,
    })
    await tx.insert(edits).values(
      changes.map(({ line, text }) => ({
        transcriptionId: editedId,
        lineIdx: line.idx,
        before: line.text,
        after: text,
        authorId,
      })),
    )
    return { kind: 'edited', transcriptionId: editedId }
  })

const linkEmptyPage = (tx: Database, pageId: string, portalUrl: string) =>
  tx
    .update(pages)
    .set({ sourceUrl: portalUrl })
    .where(and(eq(pages.id, pageId), isNull(pages.sourceUrl)))

export const verifyVersion = (
  db: Database,
  transcriptionId: string,
  verifierId: string,
  request: VerifyRequest,
): Promise<VerifyOutcome> =>
  db.transaction(async (tx) => {
    const { version, latestId } = await lockVersion(tx, transcriptionId)
    if (latestId !== version.id) return { kind: 'conflict', currentId: latestId }
    if (version.status !== 'verified') {
      await tx
        .update(transcriptions)
        .set({
          status: 'verified',
          verifiedBy: verifierId,
          verifiedAt: new Date(),
          verifiedSignature: request.signature ?? null,
        })
        .where(eq(transcriptions.id, version.id))
    }
    if (request.portalUrl !== undefined && version.pageId !== null) {
      await linkEmptyPage(tx, version.pageId, request.portalUrl)
    }
    return { kind: 'verified', transcriptionId: version.id }
  })

export const loadHistory = async (
  db: Database,
  transcriptionId: string,
): Promise<TranscriptionHistory | undefined> => {
  const [version] = await db
    .select({ regionId: transcriptions.regionId })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId))
    .limit(1)
  if (!version) return undefined

  const rows = await db
    .select({
      version: transcriptions.version,
      lineIdx: edits.lineIdx,
      before: edits.before,
      after: edits.after,
      authorName: user.name,
      createdAt: edits.createdAt,
    })
    .from(edits)
    .innerJoin(transcriptions, eq(edits.transcriptionId, transcriptions.id))
    .leftJoin(user, eq(edits.authorId, user.id))
    .where(eq(transcriptions.regionId, version.regionId))
    .orderBy(desc(transcriptions.version), desc(edits.lineIdx))
    .limit(maxHistoryEdits + 1)
  const latest = rows.slice(0, maxHistoryEdits).reverse()
  return {
    edits: latest.map(({ authorName, createdAt, ...edit }) => ({
      ...edit,
      ...(authorName !== null && { author: { name: authorName } }),
      createdAt: createdAt.toISOString(),
    })),
    ...(rows.length > maxHistoryEdits && { truncated: true as const }),
  }
}
