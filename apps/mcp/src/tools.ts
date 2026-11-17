import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ApiClient } from './api.ts'
import {
  explainInput,
  explainNote,
  explainOutput,
  toExplainOutput,
  toTranscribeOutput,
  transcribeInput,
  transcribeOutput,
} from './format.ts'

const result = (output: Record<string, unknown>, note?: string): CallToolResult => ({
  content: [
    { type: 'text', text: [note, JSON.stringify(output, null, 2)].filter(Boolean).join('\n\n') },
  ],
  structuredContent: output,
})

export const registerTools = (server: McpServer, api: ApiClient): void => {
  server.registerTool(
    'transcribe',
    {
      title: 'Прочитати фрагмент скану',
      description:
        'Читає рукописний фрагмент архівного скану (PNG у base64): рядки з позначкою непевних слів, текст сучасною орфографією, імена, місця й дати. Непевні рядки варто показувати користувачеві як непевні.',
      inputSchema: transcribeInput,
      outputSchema: transcribeOutput,
    },
    async ({ image_base64, shelfmark, hints }) =>
      result(
        toTranscribeOutput(await api.transcribe({ imageBase64: image_base64, shelfmark, hints })),
      ),
  )

  server.registerTool(
    'explain',
    {
      title: 'Пояснити термін, місце чи дату',
      description:
        'Пояснює термін, топонім, дату чи сутність лише з довідкового корпусу Хроніста, з цитатами й ліцензією джерела. Якщо джерел немає, answer — null: тоді чесно скажіть, що відповіді немає.',
      inputSchema: explainInput,
      outputSchema: explainOutput,
    },
    async ({ kind, text, period }) => {
      const output = toExplainOutput(
        await api.explain({ kind, text, context: period ? { period } : undefined }),
      )
      return result(output, explainNote(output))
    },
  )
}
