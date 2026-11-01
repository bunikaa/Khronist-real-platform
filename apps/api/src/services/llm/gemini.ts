import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { LlmOutputError, parseOutput, type LlmProvider, type LlmRequest } from './index.ts'

export type GeminiThinkingLevel = 'low' | 'medium' | 'high'

export type GeminiInteractions = Pick<GoogleGenAI['interactions'], 'create'>

export type GeminiOptions = {
  interactions: GeminiInteractions
  model: string
  thinkingLevel: GeminiThinkingLevel
  notes?: string | undefined
}

export const createGeminiInteractions = (apiKey: string): GeminiInteractions =>
  new GoogleGenAI({ apiKey }).interactions

const toInput = <T>(request: LlmRequest<T>) =>
  request.content.map((part) =>
    part.type === 'image'
      ? { type: 'image' as const, data: part.base64, mime_type: part.mediaType }
      : { type: 'text' as const, text: part.text },
  )

export const createGeminiProvider = (options: GeminiOptions): LlmProvider => ({
  name: options.model,
  complete: async (request) => {
    const { $schema: _, ...schema } = z.toJSONSchema(request.schema, { io: 'output' })
    const interaction = await options.interactions.create(
      {
        model: options.model,
        store: false,
        system_instruction: options.notes ? `${request.system}\n\n${options.notes}` : request.system,
        input: toInput(request),
        generation_config: {
          max_output_tokens: request.maxTokens,
          thinking_level: options.thinkingLevel,
        },
        response_format: { type: 'text', mime_type: 'application/json', schema },
      },
      { signal: request.signal ?? null, retries: { strategy: 'none' } },
    )
    if (interaction.status !== 'completed') {
      throw new LlmOutputError(`the model stopped early: ${interaction.status}`)
    }
    return {
      value: parseOutput(interaction.output_text ?? '', request.schema),
      model: options.model,
      usage: {
        inputTokens: interaction.usage?.total_input_tokens ?? 0,
        outputTokens:
          (interaction.usage?.total_output_tokens ?? 0) + (interaction.usage?.total_thought_tokens ?? 0),
      },
    }
  },
})
