import { shelfmarkSchema, type Box, type Shelfmark } from '@khronist/contracts'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { loadDatabaseUrl } from '../src/config.ts'
import { createDatabase } from '../src/db/client.ts'
import {
  importRecord,
  readingRecordSchema,
  versionOfReading,
  type ReadVersion,
} from '../src/services/imports.ts'
import { findOrCreatePage } from '../src/services/recognitions.ts'

const { values } = parseArgs({
  options: {
    readings: { type: 'string', default: '../../docs/demo-fund/readings' },
    pages: { type: 'string', default: '../../docs/demo-fund/pages.json' },
    'dry-run': { type: 'boolean', default: false },
  },
})
const { readings, pages } = values

const archiumArchive = 'ЦДІАК України'
const archiumHost = 'https://archium.cdiak.archives.gov.ua'

const demoFundSchema = z.object({
  host: z.literal(archiumHost),
  files: z.array(
    z.object({
      fond: z.string(),
      opys: z.string(),
      sprava: z.string(),
      years: z.string().regex(/^\d{4}$/),
      pages: z.array(
        z.object({
          image: z.number().int().min(1),
          viewerUrl: z.httpUrl(),
          imageUrl: z.httpUrl(),
        }),
      ),
    }),
  ),
})

const readingFileSchema = z.object({
  sprava: z.string(),
  image: z.number().int().min(1),
  skipped: z.string().nullish(),
  records: z.array(readingRecordSchema).default([]),
})

type Sheet = { shelfmark: Shelfmark; year: number; imageUrl: string }
type Prepared = { box: Box; imageHash: string; version: ReadVersion }

const demoFund = demoFundSchema.parse(JSON.parse(readFileSync(pages, 'utf8')))

const sheetOf = (sprava: string, image: number): Sheet => {
  const file = demoFund.files.find((candidate) => candidate.sprava === sprava)
  const page = file?.pages.find((candidate) => candidate.image === image)
  if (!file || !page) throw new Error(`sprava ${sprava}, image ${image} is not in the demo fund`)
  const shelfmark = shelfmarkSchema.parse({
    archive: archiumArchive,
    fond: file.fond,
    opys: file.opys,
    sprava,
    image,
    portal: 'archium',
    portalUrl: page.viewerUrl,
  })
  return { shelfmark, year: Number(file.years), imageUrl: page.imageUrl }
}

const regionKeyOf = (imageUrl: string, box: Box) =>
  createHash('sha256')
    .update(`${imageUrl}#${JSON.stringify(box)}`)
    .digest('hex')

const problems: string[] = []

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const prepareRecords = (name: string, sheet: Sheet, reading: z.infer<typeof readingFileSchema>) => {
  const keys = new Set<string>()
  return reading.records.flatMap((record, index): Prepared[] => {
    const imageHash = regionKeyOf(sheet.imageUrl, record.box)
    if (keys.has(imageHash)) {
      problems.push(`${name}, record ${index}: the same box as an earlier record of the sheet`)
      return []
    }
    keys.add(imageHash)
    try {
      return [{ box: record.box, imageHash, version: versionOfReading(record) }]
    } catch (error) {
      problems.push(`${name}, record ${index}: ${reasonOf(error)}`)
      return []
    }
  })
}

const sheetFiles = new Map<string, string>()

const prepareFile = (name: string) => {
  try {
    const reading = readingFileSchema.parse(JSON.parse(readFileSync(join(readings, name), 'utf8')))
    if (reading.skipped) {
      console.log(`${name}: skipped, ${reading.skipped}`)
      return []
    }
    const sheetKey = `${reading.sprava}/${reading.image}`
    const earlier = sheetFiles.get(sheetKey)
    if (earlier) throw new Error(`holds the same sheet as ${earlier}`)
    sheetFiles.set(sheetKey, name)
    const sheet = sheetOf(reading.sprava, reading.image)
    return [{ sheet, records: prepareRecords(name, sheet, reading) }]
  } catch (error) {
    problems.push(`${name}: ${reasonOf(error)}`)
    return []
  }
}

const prepared = readdirSync(readings)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .flatMap(prepareFile)

const recordCount = prepared.reduce((sum, file) => sum + file.records.length, 0)
console.log(
  `checked ${prepared.length} sheets, ${recordCount} records, ${problems.length} problems`,
)
for (const problem of problems) console.log(problem)
if (problems.length > 0) process.exitCode = 1

if (!values['dry-run'] && problems.length === 0) {
  const { db, client } = createDatabase(loadDatabaseUrl())
  const outcome = { created: 0, exists: 0 }
  try {
    for (const { sheet, records } of prepared) {
      const pageId = await findOrCreatePage(db, sheet.shelfmark, {
        document: { yearFrom: sheet.year, yearTo: sheet.year },
      })
      for (const { box, imageHash, version } of records) {
        outcome[await importRecord(db, { pageId, box, imageHash }, version)] += 1
      }
    }
  } finally {
    await client.end({ timeout: 5 })
  }
  console.log(
    `created ${outcome.created}, already there ${outcome.exists} (left as they are: the import never rewrites a region)`,
  )
}
