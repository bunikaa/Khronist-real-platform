import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ApiClient } from './api.ts'
import {
  explainInput,
  explainNote,
  explainOutput,
  searchInput,
  searchNote,
  searchOutput,
  toExplainOutput,
  toSearchOutput,
  toTranscribeOutput,
  transcribeInput,
  transcribeOutput,
} from './format.ts'

export type ToolCall = { tool: string; ms: number; ok: boolean }
export type ToolLog = (call: ToolCall) => void

const result = (output: Record<string, unknown>, note?: string): CallToolResult => ({
  content: [
    { type: 'text', text: [note, JSON.stringify(output, null, 2)].filter(Boolean).join('\n\n') },
  ],
  structuredContent: output,
})

const timed = async (
  tool: string,
  log: ToolLog,
  call: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
  const started = performance.now()
  let ok = false
  try {
    const value = await call()
    ok = true
    return value
  } finally {
    log({ tool, ms: Math.round(performance.now() - started), ok })
  }
}

export const registerTools = (server: McpServer, api: ApiClient, log: ToolLog): void => {
  server.registerTool(
    'transcribe',
    {
      title: 'Прочитати фрагмент скану',
      description:
        'Читає рукописний фрагмент архівного скану (PNG у base64): рядки з позначкою непевних слів, текст сучасною орфографією, імена, місця й дати. Непевні рядки варто показувати користувачеві як непевні. Якщо читання триває довше за 50 с, інструмент повертає помилку still_reading — тоді викличте його ще раз з тим самим зображенням.',
      inputSchema: transcribeInput,
      outputSchema: transcribeOutput,
    },
    ({ image_base64, shelfmark, hints }) =>
      timed('transcribe', log, async () =>
        result(
          toTranscribeOutput(await api.transcribe({ imageBase64: image_base64, shelfmark, hints })),
        ),
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
    ({ kind, text, period }) =>
      timed('explain', log, async () => {
        const output = toExplainOutput(
          await api.explain({ kind, text, context: period ? { period } : undefined }),
        )
        return result(output, explainNote(output))
      }),
  )

  server.registerTool(
    'search_sources',
    {
      title: 'Знайти в Commons',
      description:
        "Шукає в уже прочитаних транскрипціях Хроніста (Commons, CC BY 4.0) за ім'ям, селом чи словом: шифр аркуша, роки, уривок, статус і посилання на портал. verified — версію підтвердила людина; draft і disputed так і подавайте користувачеві.",
      inputSchema: searchInput,
      outputSchema: searchOutput,
    },
    ({ query, verified_only, limit }) =>
      timed('search_sources', log, async () => {
        const output = toSearchOutput(
          await api.search({ query, verifiedOnly: verified_only, limit }),
        )
        return result(output, searchNote(output))
      }),
  )
}
