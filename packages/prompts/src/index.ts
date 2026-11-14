import { readFileSync } from 'node:fs'

export type PromptName = 'htr_vision' | 'normalize' | 'entities' | 'explain'

export type Prompt = {
  system: string
  user: string
  schema: unknown
}

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').trim()

export const loadPrompt = (name: PromptName): Prompt => ({
  system: `${read('_shared/persona.md')}\n\n${read(`${name}/system.md`)}`,
  user: read(`${name}/user.md`),
  schema: JSON.parse(read(`${name}/schema.json`)),
})

export const loadProviderNotes = (name: PromptName, provider: 'gemini'): string =>
  read(`${name}/${provider}.md`)

export const renderPrompt = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`prompt variable ${key} has no value`)
    return value
  })
