import { loadProviderNotes } from '@khronist/prompts'
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../src/config.ts'
import { createProvider } from '../src/services/llm/select.ts'
import { createVisionReader, type VisionReadLog } from '../src/services/htr/vision.ts'

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    fragments: { type: 'string' },
    out: { type: 'string' },
  },
})
const { model, fragments, out } = values
if (!model || !fragments || !out) {
  throw new Error(
    'usage: read-fragments --model <name> --fragments <dir of png> --out <file.jsonl>',
  )
}

const config = loadConfig()
const provider = createProvider(config, {
  model,
  effort: config.HTR_EFFORT,
  geminiNotes: loadProviderNotes('htr_vision', 'gemini'),
})
if (!provider) throw new Error(`no API key for ${model}`)

const logs: VisionReadLog[] = []
const reader = createVisionReader(provider, (details) => logs.push(details))
const settings = model.startsWith('gemini-')
  ? { thinkingLevel: 'low' }
  : { effort: config.HTR_EFFORT }

const files = readdirSync(fragments)
  .filter((name) => name.endsWith('.png'))
  .sort()

for (const file of files) {
  const fragment = basename(file, '.png')
  const startedAt = Date.now()
  try {
    const { lines, reader: servedBy } = await reader.read({
      image: readFileSync(join(fragments, file)),
    })
    const log = logs.pop()
    const record = {
      fragment,
      model,
      reader: servedBy,
      settings,
      durationMs: log?.durationMs ?? Date.now() - startedAt,
      usage: log?.usage,
      warnings: log?.warnings ?? [],
      lines: lines.map(({ text, words }) => ({ text, words })),
    }
    appendFileSync(out, `${JSON.stringify(record)}\n`)
    console.log(`${fragment}: ${lines.length} lines, ${record.durationMs} ms`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendFileSync(
      out,
      `${JSON.stringify({ fragment, model, durationMs: Date.now() - startedAt, error: message })}\n`,
    )
    console.log(`${fragment}: failed, ${message}`)
  }
}
