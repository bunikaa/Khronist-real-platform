import Anthropic from '@anthropic-ai/sdk'
import type { Config } from '../../config.ts'
import {
  asLimitError,
  parseOutput,
  toJsonSchema,
  type LlmProvider,
  type LlmRequest,
} from './index.ts'

export type AnthropicMessages = Pick<Anthropic['beta']['messages'], 'create'>

type AnthropicOptions = {
  messages: AnthropicMessages
  model: string
  effort: Config['HTR_EFFORT']
}

export const createAnthropicMessages = (apiKey: string): AnthropicMessages =>
  new Anthropic({ apiKey, maxRetries: 0 }).beta.messages

const toContent = <T>(request: LlmRequest<T>): Anthropic.Beta.BetaContentBlockParam[] =>
  request.content.map((part) =>
    part.type === 'image'
      ? {
          type: 'image',
          source: { type: 'base64', media_type: part.mediaType, data: part.base64 },
        }
      : { type: 'text', text: part.text },
  )

const answerText = (content: Anthropic.Beta.BetaContentBlock[]): string => {
  const handover = content.findLastIndex((block) => block.type === 'fallback')
  return content
    .slice(handover + 1)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
}

const servedBy = (message: Anthropic.Beta.BetaMessage): string =>
  message.usage.iterations?.findLast((step) => step.type === 'fallback_message')?.model ??
  message.model

export const createAnthropicProvider = (options: AnthropicOptions): LlmProvider => ({
  name: options.model,
  complete: async (request) => {
    const message = await options.messages
      .create(
        {
          model: options.model,
          max_tokens: request.maxTokens,
          system: request.system,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: {
            effort: options.effort,
            format: { type: 'json_schema', schema: toJsonSchema(request.schema) },
          },
          messages: [{ role: 'user', content: toContent(request) }],
        },
        { signal: request.signal },
      )
      .catch((error: unknown) => {
        throw asLimitError(error)
      })
    if (message.stop_reason !== 'end_turn') {
      throw new Error(`the model stopped early: ${message.stop_reason}`)
    }
    return {
      value: parseOutput(answerText(message.content), request.schema),
      model: servedBy(message),
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    }
  },
})
