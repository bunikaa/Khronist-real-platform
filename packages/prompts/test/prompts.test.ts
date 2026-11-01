import { htrVisionOutputSchema } from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadPrompt, renderPrompt } from '../src/index.ts'

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

  it('has a value for every template variable', () => {
    const text = renderPrompt(prompt.user, { language: 'ru', period: '19', documentType: 'metric' })
    expect(text).toContain('Language: ru')
    expect(text).not.toContain('{{')
  })
})

describe('renderPrompt', () => {
  it('refuses a missing variable', () => {
    expect(() => renderPrompt('{{a}}', {})).toThrow(/a has no value/)
  })
})
