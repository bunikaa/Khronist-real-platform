import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { LlmOutputError, parseOutput, type LlmProvider, type LlmRequest } from './index.ts'

export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AnthropicMessages = Pick<Anthropic['beta']['messages'], 'create'>

export type AnthropicOptions = {
  messages: AnthropicMessages
  model: string
  effort: LlmEffort
}

export const createAnthropicMessages = (apiKey: string): AnthropicMessages =>
  new Anthropic({ apiKey, maxRetries: 1 }).beta.messages

const toContent = <T>(request: LlmRequest<T>): Anthropic.Beta.BetaContentBlockParam[] =>
  request.content.map((part) =>
    part.type === 'image'
      ? {
          type: 'image',
          source: { type: 'base64', media_type: part.mediaType, data: part.base64 },
        }
      : { type: 'text', text: part.text },
  )

export const createAnthropicProvider = (options: AnthropicOptions): LlmProvider => ({
  name: options.model,
  complete: async (request) => {
    const { $schema: _, ...schema } = z.toJSONSchema(request.schema, { io: 'output' })
    const message = await options.messages.create(
      {
        model: options.model,
        max_tokens: request.maxTokens,
        system: request.system,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: options.effort,
          format: { type: 'json_schema', schema },
        },
        messages: [{ role: 'user', content: toContent(request) }],
      },
      { signal: request.signal },
    )
    if (message.stop_reason === 'refusal') throw new Error(`the model declined: ${options.model}`)
    if (message.stop_reason !== 'end_turn') {
      throw new LlmOutputError(`the model stopped early: ${message.stop_reason}`)
    }
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
    return {
      value: parseOutput(text, request.schema),
      model: message.model,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    }
  },
})
