import { eq } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import type { Database } from '../db/client.ts'
import { apiKeys } from '../db/schema.ts'

const apiKeyPrefix = 'khr_'

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex')

export const isApiKey = (token: string) => token.startsWith(apiKeyPrefix)

export const findApiKeyId = async (db: Database, keyHash: string): Promise<string | undefined> => {
  const [row] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1)
  return row?.id
}

export const createApiKey = async (db: Database, name: string): Promise<string> => {
  const key = `${apiKeyPrefix}${randomBytes(32).toString('base64url')}`
  await db.insert(apiKeys).values({ name, keyHash: hashApiKey(key) })
  return key
}
