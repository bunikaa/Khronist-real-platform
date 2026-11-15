import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const apiRoot = fileURLToPath(new URL('..', import.meta.url))

const startServer = () =>
  new Promise<{ code: number | null; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      ['src/server.ts'],
      {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: '', PORT: '3997' },
        encoding: 'utf8',
        timeout: 30_000,
      },
      (error, _stdout, stderr) =>
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stderr }),
    )
  })

describe('native Node runtime', () => {
  it('loads every module without a bundler and fails fast on invalid configuration', async () => {
    const result = await startServer()
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Invalid configuration')
    expect(result.stderr).toContain('DATABASE_URL')
    expect(result.stderr).not.toContain('ERR_UNSUPPORTED')
    expect(result.stderr).not.toContain('SyntaxError')
  }, 35_000)
})
