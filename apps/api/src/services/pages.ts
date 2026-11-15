import type { PageLookupQuery, PageLookupResponse, Shelfmark } from '@khronist/contracts'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { documents, pages, regions, transcriptions } from '../db/schema.ts'
import { shelfmarkOf } from './transcriptions.ts'

type SheetIdentity = Pick<Shelfmark, 'archive' | 'fond' | 'opys' | 'sprava' | 'folio' | 'image'>

export const documentMatch = (sheet: SheetIdentity) =>
  and(
    eq(documents.archive, sheet.archive),
    eq(documents.fond, sheet.fond),
    eq(documents.opys, sheet.opys),
    eq(documents.sprava, sheet.sprava),
  )

export const pageIdentity = (sheet: SheetIdentity) => {
  if (sheet.image !== undefined) {
    return { imageNo: sheet.image, folio: null, match: eq(pages.imageNo, sheet.image) }
  }
  if (sheet.folio !== undefined) {
    return { imageNo: null, folio: sheet.folio, match: eq(pages.folio, sheet.folio) }
  }
  return undefined
}

export const lookupPage = async (
  db: Database,
  query: PageLookupQuery,
): Promise<PageLookupResponse> => {
  const identity = pageIdentity(query)
  if (!identity) return {}
  const [found] = await db
    .select({ page: pages, document: documents })
    .from(pages)
    .innerJoin(documents, eq(pages.documentId, documents.id))
    .where(and(documentMatch(query), identity.match))
    .limit(1)
  if (!found) return {}

  const latest = await db
    .selectDistinctOn([transcriptions.regionId], {
      id: transcriptions.id,
      regionId: transcriptions.regionId,
      version: transcriptions.version,
      status: transcriptions.status,
      createdAt: transcriptions.createdAt,
      x: regions.x,
      y: regions.y,
      w: regions.w,
      h: regions.h,
    })
    .from(transcriptions)
    .innerJoin(regions, eq(transcriptions.regionId, regions.id))
    .where(eq(regions.pageId, found.page.id))
    .orderBy(asc(transcriptions.regionId), desc(transcriptions.version))

  return {
    page: {
      id: found.page.id,
      shelfmark: shelfmarkOf(found.document, found.page),
      transcriptions: latest.map((row) => ({
        id: row.id,
        regionId: row.regionId,
        box: { x: row.x, y: row.y, w: row.w, h: row.h },
        version: row.version,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    },
  }
}
