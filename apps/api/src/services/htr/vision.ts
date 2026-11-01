import { htrVisionOutputSchema, visionToLines, type Hints } from '@khronist/contracts'
import { loadPrompt, renderPrompt } from '@khronist/prompts'
import type { LlmProvider, LlmUsage } from '../llm/index.ts'
import type { HtrReader } from './index.ts'

const maxOutputTokens = 8000

export type VisionReadLog = {
  model: string
  usage: LlmUsage
  durationMs: number
  lines: number
  warnings: string[]
}

const promptValues = (hints: Hints | undefined) => ({
  language: hints?.language ?? 'unknown',
  period: hints?.period ?? 'unknown',
  documentType: hints?.documentType ?? 'unknown',
})

export const createVisionReader = (
  llm: LlmProvider,
  onRead: (details: VisionReadLog) => void,
): HtrReader => {
  const prompt = loadPrompt('htr_vision')
  return {
    kind: 'vision',
    name: llm.name,
    read: async ({ image, hints, signal }) => {
      const startedAt = Date.now()
      const { value, model, usage } = await llm.complete({
        system: prompt.system,
        content: [
          { type: 'image', mediaType: 'image/png', base64: image.toString('base64') },
          { type: 'text', text: renderPrompt(prompt.user, promptValues(hints)) },
        ],
        schema: htrVisionOutputSchema,
        maxTokens: maxOutputTokens,
        signal,
      })
      onRead({
        model,
        usage,
        durationMs: Date.now() - startedAt,
        lines: value.lines.length,
        warnings: value.warnings,
      })
      return visionToLines(value)
    },
  }
}
