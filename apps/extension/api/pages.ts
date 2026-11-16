import {
  pageLookupResponseSchema,
  type PageLookupResponse,
  type Shelfmark,
} from '@khronist/contracts'
import { send } from './client.ts'

export const lookupPage = async (
  shelfmark: Shelfmark,
  signal: AbortSignal,
): Promise<PageLookupResponse> => {
  const { archive, fond, opys, sprava, folio, image } = shelfmark
  const query = new URLSearchParams({ archive, fond, opys, sprava })
  if (folio !== undefined) query.set('folio', folio)
  if (image !== undefined) query.set('image', String(image))
  const response = await send(`/v1/pages/lookup?${query}`, { signal })
  return pageLookupResponseSchema.parse(await response.json())
}
