import {
  explainResponseSchema,
  type ExplainRequest,
  type ExplainResponse,
} from '@khronist/contracts'
import { send } from './client.ts'

export const explain = async (
  body: ExplainRequest,
  signal: AbortSignal,
): Promise<ExplainResponse> => {
  const response = await send('/v1/explain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return explainResponseSchema.parse(await response.json())
}
