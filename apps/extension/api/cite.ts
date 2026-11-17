import { citeResponseSchema, type CiteRequest } from '@khronist/contracts'
import { send } from './client.ts'

export const citeTranscription = async (
  request: CiteRequest,
  signal: AbortSignal,
): Promise<string> => {
  const response = await send('/v1/cite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  return citeResponseSchema.parse(await response.json()).text
}
