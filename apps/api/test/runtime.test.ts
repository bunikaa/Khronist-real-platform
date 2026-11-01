import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const apiRoot = fileURLToPath(new URL('..', import.meta.url))

describe('native Node runtime', () => {
  it('loads every module without a bundler and fails fast on invalid configuration', () => {
    const result = spawnSync(process.execPath, ['src/server.ts'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: '', PORT: '3997' },
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid configuration')
    expect(result.stderr).toContain('DATABASE_URL')
    expect(result.stderr).not.toContain('ERR_UNSUPPORTED')
    expect(result.stderr).not.toContain('SyntaxError')
  })
})
