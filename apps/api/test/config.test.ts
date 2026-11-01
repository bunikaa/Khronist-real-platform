import { describe, expect, it } from 'vitest'
import { describeProviders, loadConfig } from '../src/config.ts'

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(base)
    expect(config.PORT).toBe(3000)
    expect(config.NODE_ENV).toBe('development')
  })

  it('fails without a database url', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
  })

  it('rejects an invalid port, log level and HTR url', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
    expect(() => loadConfig({ ...base, HTR_URL: 'not a url' })).toThrow(/HTR_URL/)
  })

  it('treats empty optional variables as unset', () => {
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: '', HTR_URL: '' })
    expect(config.ANTHROPIC_API_KEY).toBeUndefined()
    expect(config.HTR_URL).toBeUndefined()
  })
})

describe('describeProviders', () => {
  it('uses the vision reader when only the LLM key is set', () => {
    expect(describeProviders(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' }))).toEqual({
      llm: 'ok',
      htr: 'vision',
    })
  })

  it('switches to the remote reader when HTR_URL is set', () => {
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: 'k', HTR_URL: 'https://htr.example.org' })
    expect(describeProviders(config).htr).toBe('remote')
  })

  it('reports no reader without any provider', () => {
    expect(describeProviders(loadConfig(base))).toEqual({ llm: 'degraded', htr: 'down' })
  })
})
