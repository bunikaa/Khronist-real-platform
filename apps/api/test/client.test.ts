import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/db/client.ts'

const unreachable = 'postgres://user:pass@127.0.0.1:1/khronist'

describe('createDatabase', () => {
  it('sets a statement timeout only when the server asks for it', async () => {
    const server = createDatabase(unreachable, { statementTimeoutMs: 15_000 })
    const migrations = createDatabase(unreachable)
    expect(server.client.options.connection.statement_timeout).toBe(15_000)
    expect(migrations.client.options.connection.statement_timeout).toBeUndefined()
    await server.client.end()
    await migrations.client.end()
  })
})
