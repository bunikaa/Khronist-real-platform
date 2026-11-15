import { describe, expect, it } from 'vitest'
import { llmStatus, loadConfig, loadDatabaseUrl, signInSettings } from '../src/config.ts'

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }
const signIn = {
  RESEND_API_KEY: 're_test',
  BETTER_AUTH_SECRET: 's'.repeat(32),
  BETTER_AUTH_URL: 'https://api.khronist.example',
  MAIL_FROM: 'Хроніст <noreply@khronist.example>',
}

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

describe('loadDatabaseUrl', () => {
  it('needs only the database url, so a migration does not depend on model settings', () => {
    expect(loadDatabaseUrl({ ...base, HTR_MODEL_FALLBACK: 'gemini-x' })).toBe(base.DATABASE_URL)
    expect(() => loadDatabaseUrl({})).toThrow(/DATABASE_URL/)
  })
})

describe('remote reader', () => {
  it('refuses HTR_URL until the remote reader exists, so it cannot look switched on', () => {
    expect(() => loadConfig({ ...base, HTR_URL: 'https://htr.example/recognize' })).toThrow(
      /HTR_URL/,
    )
  })
})

describe('llmStatus', () => {
  it('is ok when the API key is set', () => {
    expect(llmStatus(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' }))).toBe('ok')
  })

  it('is degraded without a key', () => {
    expect(llmStatus(loadConfig(base))).toBe('degraded')
  })

  it('looks at the key of the primary model, not always at the same provider', () => {
    const gemini = { ...base, HTR_MODEL_PRIMARY: 'gemini-x' }
    expect(llmStatus(loadConfig({ ...gemini, GOOGLE_API_KEY: 'g' }))).toBe('ok')
    expect(llmStatus(loadConfig({ ...gemini, ANTHROPIC_API_KEY: 'a' }))).toBe('degraded')
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
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', LLM_FIXTURES: '1' })).toThrow(
      /LLM_FIXTURES/,
    )
  })

  it('allows fixtures outside production and production without them', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development', LLM_FIXTURES: '1' }).LLM_FIXTURES).toBe(
      true,
    )
    expect(
      loadConfig({ ...base, ...signIn, NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k' })
        .LLM_FIXTURES,
    ).toBe(false)
  })

  it('refuses to start production without sign-in mail', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k' })).toThrow(
      /RESEND_API_KEY/,
    )
  })

  it('refuses to start production without a key for the primary model', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/HTR_MODEL_PRIMARY/)
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        HTR_MODEL_PRIMARY: 'gemini-x',
        ANTHROPIC_API_KEY: 'a',
      }),
    ).toThrow(/HTR_MODEL_PRIMARY/)
  })

  it('reads the header that carries the client address', () => {
    expect(loadConfig(base).CLIENT_IP_HEADER).toBeUndefined()
    expect(loadConfig({ ...base, CLIENT_IP_HEADER: '' }).CLIENT_IP_HEADER).toBeUndefined()
    expect(loadConfig({ ...base, CLIENT_IP_HEADER: 'x-real-ip' }).CLIENT_IP_HEADER).toBe(
      'x-real-ip',
    )
    expect(() => loadConfig({ ...base, CLIENT_IP_HEADER: 'X-Real-IP' })).toThrow(/CLIENT_IP_HEADER/)
  })
})

describe('sign-in settings', () => {
  it('turns sign-in off without a mail key', () => {
    expect(signInSettings(loadConfig(base))).toBeUndefined()
  })

  it('turns sign-in on with the mail key, secret, address and sender', () => {
    expect(signInSettings(loadConfig({ ...base, ...signIn }))).toEqual({
      secret: signIn.BETTER_AUTH_SECRET,
      baseURL: signIn.BETTER_AUTH_URL,
      resendApiKey: signIn.RESEND_API_KEY,
      mailFrom: signIn.MAIL_FROM,
    })
  })

  it('refuses a mail key without the rest of the sign-in settings', () => {
    expect(() => loadConfig({ ...base, ...signIn, MAIL_FROM: '' })).toThrow(/RESEND_API_KEY/)
  })

  it('refuses a short secret', () => {
    expect(() => loadConfig({ ...base, ...signIn, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    )
  })
})

describe('guest access settings', () => {
  it('allows no origins, three hundred readings and two thousand model calls by default', () => {
    const config = loadConfig({ ...base, CORS_ORIGINS: '' })
    expect(config.CORS_ORIGINS).toEqual([])
    expect(config.GUEST_RECOGNITIONS_PER_DAY).toBe(300)
    expect(config.MODEL_CALLS_PER_DAY).toBe(2000)
  })

  it('reads the draining window of the deployment', () => {
    expect(loadConfig(base).RAILWAY_DEPLOYMENT_DRAINING_SECONDS).toBeUndefined()
    expect(
      loadConfig({ ...base, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '150' })
        .RAILWAY_DEPLOYMENT_DRAINING_SECONDS,
    ).toBe(150)
  })

  it('splits origins including an extension origin', () => {
    const origins = 'https://khronist.example, chrome-extension://abcdef'
    expect(loadConfig({ ...base, CORS_ORIGINS: origins }).CORS_ORIGINS).toEqual([
      'https://khronist.example',
      'chrome-extension://abcdef',
    ])
  })

  it.each(['*', 'https://*.example.com', 'https://khronist.example/', 'khronist.example'])(
    'refuses the origin %s',
    (origin) => {
      expect(() => loadConfig({ ...base, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/)
    },
  )
})
