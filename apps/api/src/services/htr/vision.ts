import {
  htrVisionOutputSchema,
  readingWarningSchema,
  visionToLines,
  type ReadingWarning,
} from '@khronist/contracts'
import { loadPrompt, renderPrompt } from '@khronist/prompts'
import { hintValues } from '../hints.ts'
import type { LlmProvider } from '../llm/index.ts'
import type { HtrReader } from './index.ts'

const maxOutputTokens = 4096

const collapseSpaces = (text: string) => text.trim().replace(/\s+/g, ' ')

const fitaFromLookalike: Record<string, string> = { Ө: 'Ѳ', ө: 'ѳ' }

const restoreFita = (text: string) =>
  text.replace(/[Өө]/g, (letter) => fitaFromLookalike[letter] ?? letter)

const visionOutput = htrVisionOutputSchema
  .overwrite((output) => ({
    ...output,
    lines: output.lines.map((line) => ({
      text: restoreFita(line.text),
      words: line.words.map((word) => ({ ...word, text: restoreFita(word.text) })),
    })),
  }))
  .refine(
    ({ lines }) =>
      lines.every(
        (line) => line.words.map((word) => word.text).join(' ') === collapseSpaces(line.text),
      ),
    { message: 'the words of a line must add up to its text' },
  )

const knownWarnings = (warnings: string[]): ReadingWarning[] => [
  ...new Set(
    warnings.flatMap((warning) => {
      const parsed = readingWarningSchema.safeParse(warning.trim().toLowerCase())
      return parsed.success ? [parsed.data] : []
    }),
  ),
]

export const createVisionReader = (llm: LlmProvider): HtrReader => {
  const prompt = loadPrompt('htr_vision')
  return {
    kind: 'vision',
    read: async ({ image, hints, signal, log }) => {
      const startedAt = Date.now()
      const { value, model, usage } = await llm.complete({
        system: prompt.system,
        content: [
          { type: 'image', mediaType: 'image/png', base64: image.toString('base64') },
          { type: 'text', text: renderPrompt(prompt.user, hintValues(hints)) },
        ],
        schema: visionOutput,
        maxTokens: maxOutputTokens,
        signal,
        log,
      })
      log?.info(
        {
          model,
          usage,
          durationMs: Date.now() - startedAt,
          lines: value.lines.length,
          warnings: value.warnings,
        },
        'fragment read',
      )
      return {
        lines: visionToLines(value),
        warnings: knownWarnings(value.warnings),
        reader: model,
      }
    },
  }
}
