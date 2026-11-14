import { readFileSync } from 'node:fs'
import {
  entitiesOutputSchema,
  hintsSchema,
  htrVisionOutputSchema,
  normalizeOutputSchema,
} from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadPrompt, loadProviderNotes, renderPrompt } from '../src/index.ts'

describe('htr_vision', () => {
  const prompt = loadPrompt('htr_vision')

  it('starts the system prompt with the shared persona', () => {
    expect(prompt.system.startsWith('Ти — Хроніст')).toBe(true)
    expect(prompt.system).toContain('[нрзб]')
  })

  it('keeps schema.json equal to the contract', () => {
    const { $schema: _, ...contract } = z.toJSONSchema(htrVisionOutputSchema, { io: 'output' })
    expect(prompt.schema).toEqual(contract)
  })

  it('keeps provider notes out of the shared prompt', () => {
    const notes = loadProviderNotes('htr_vision', 'gemini')
    expect(notes).toContain('[нрзб]')
    expect(prompt.system).not.toContain(notes)
  })

  it('has a value for every template variable', () => {
    const text = renderPrompt(prompt.user, { language: 'ru', period: '19', documentType: 'metric' })
    expect(text).toContain('Language: ru')
    expect(text).not.toContain('{{')
  })
})

describe('normalize', () => {
  const prompt = loadPrompt('normalize')

  const exampleSchema = z.object({
    source: z.string(),
    input: hintsSchema.extend({ lines: htrVisionOutputSchema.shape.lines }),
    output: normalizeOutputSchema,
  })
  const examples = readFileSync(new URL('../normalize/examples.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => exampleSchema.parse(JSON.parse(line)))

  it('starts the system prompt with the shared persona', () => {
    expect(prompt.system.startsWith('Ти — Хроніст')).toBe(true)
    expect(prompt.system).toContain('[нрзб]')
  })

  it('keeps schema.json equal to the contract', () => {
    const { $schema: _, ...contract } = z.toJSONSchema(normalizeOutputSchema, { io: 'output' })
    expect(prompt.schema).toEqual(contract)
  })

  it('has a value for every template variable', () => {
    const text = renderPrompt(prompt.user, {
      language: 'ru',
      period: '19',
      documentType: 'metric',
      lines: '[]',
    })
    expect(text).toContain('Language: ru')
    expect(text).not.toContain('{{')
  })

  it('has examples that keep every line and every uncertain word', () => {
    expect(examples.length).toBeGreaterThanOrEqual(5)
    for (const { input, output } of examples) {
      expect(output.lines).toHaveLength(input.lines.length)
      output.lines.forEach((line, i) => {
        expect(line.words.map((word) => word.text).join(' ')).toBe(line.text)
        expect(line.words.map((word) => word.uncertain)).toEqual(
          input.lines[i]?.words.map((word) => word.uncertain),
        )
      })
    }
  })

  it('has examples without pre-reform letters or a final hard sign', () => {
    for (const { output } of examples) {
      for (const line of output.lines) {
        expect(line.text).not.toMatch(/[ѣѳіѵѢѲІѴ]/)
        expect(line.text).not.toMatch(/ъ(?=[\s,.;:—-]|$)/)
      }
    }
  })
})

describe('entities', () => {
  const prompt = loadPrompt('entities')

  const exampleSchema = z.object({
    source: z.string(),
    input: hintsSchema.extend({ text: z.string() }),
    output: entitiesOutputSchema,
  })
  const examples = readFileSync(new URL('../entities/examples.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => exampleSchema.parse(JSON.parse(line)))

  it('starts the system prompt with the shared persona', () => {
    expect(prompt.system.startsWith('Ти — Хроніст')).toBe(true)
    expect(prompt.system).toContain('[нрзб]')
  })

  it('keeps schema.json equal to the contract', () => {
    const { $schema: _, ...contract } = z.toJSONSchema(entitiesOutputSchema, { io: 'output' })
    expect(prompt.schema).toEqual(contract)
  })

  it('has a value for every template variable', () => {
    const text = renderPrompt(prompt.user, {
      language: 'ru',
      period: '19',
      documentType: 'metric',
      text: '',
    })
    expect(text).toContain('Language: ru')
    expect(text).not.toContain('{{')
  })

  it('has examples whose entities follow each other in the text', () => {
    expect(examples.length).toBeGreaterThanOrEqual(5)
    for (const { input, output } of examples) {
      let from = 0
      for (const entity of output.entities) {
        const at = input.text.indexOf(entity.text, from)
        expect(at, entity.text).toBeGreaterThanOrEqual(0)
        from = at + entity.text.length
      }
    }
  })

  it('has examples without unreadable words or hyphens in normalized forms', () => {
    for (const { output } of examples) {
      for (const entity of output.entities) {
        expect(entity.text).not.toContain('[нрзб]')
        expect(entity.normalized).not.toMatch(/-\n|\n/)
      }
    }
  })
})

describe('renderPrompt', () => {
  it('refuses a missing variable', () => {
    expect(() => renderPrompt('{{a}}', {})).toThrow(/a has no value/)
  })
})
