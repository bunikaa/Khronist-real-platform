import { chatResponseSchema, type ChatRequest, type ChatResponse } from '@khronist/contracts'
import { send } from './client.ts'

export const askChat = async (body: ChatRequest, signal: AbortSignal): Promise<ChatResponse> => {
  const response = await send('/v1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return chatResponseSchema.parse(await response.json())
}
