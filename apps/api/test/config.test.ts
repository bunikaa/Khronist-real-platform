import { describe, expect, it } from 'vitest'
import { llmStatus, loadConfig } from '../src/config.ts'

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

describe('llmStatus', () => {
  it('is ok when the API key is set', () => {
    expect(llmStatus(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' }))).toBe('ok')
  })

  it('is degraded without a key', () => {
    expect(llmStatus(loadConfig(base))).toBe('degraded')
  })
})

describe('job settings', () => {
  it('defaults to four concurrent jobs and no fixtures', () => {
    const config = loadConfig(base)
    expect(config.JOBS_CONCURRENCY).toBe(4)
    expect(config.LLM_FIXTURES).toBe(false)
  })

  it('reads LLM_FIXTURES=1 as true and an empty value as the default', () => {
    expect(loadConfig({ ...base, LLM_FIXTURES: '1' }).LLM_FIXTURES).toBe(true)
    expect(loadConfig({ ...base, LLM_FIXTURES: '' }).LLM_FIXTURES).toBe(false)
  })

  it('rejects an invalid concurrency', () => {
    expect(() => loadConfig({ ...base, JOBS_CONCURRENCY: '0' })).toThrow(/JOBS_CONCURRENCY/)
  })
})

describe('production safety', () => {
  it('refuses fixtures in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', LLM_FIXTURES: '1' })).toThrow(/LLM_FIXTURES/)
  })

  it('allows fixtures outside production and production without them', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development', LLM_FIXTURES: '1' }).LLM_FIXTURES).toBe(true)
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).LLM_FIXTURES).toBe(false)
  })

  it('reads the proxy trust flag', () => {
    expect(loadConfig(base).TRUST_PROXY).toBe(false)
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true)
  })
})
