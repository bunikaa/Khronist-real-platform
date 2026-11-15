import { loadDatabaseUrl } from '../src/config.ts'
import { createDatabase } from '../src/db/client.ts'
import { createApiKey } from '../src/services/api-keys.ts'

const name = process.argv[2]?.trim()
if (!name) {
  console.error('usage: pnpm --filter @khronist/api api-key:create "<who uses the key>"')
  process.exit(1)
}

const { db, client } = createDatabase(loadDatabaseUrl())
try {
  console.log(await createApiKey(db, name))
} finally {
  await client.end({ timeout: 5 })
}
