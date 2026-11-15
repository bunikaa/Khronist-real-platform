import { describe, expect, it } from 'vitest'
import { safeError } from '../src/lib/log.ts'

describe('safeError', () => {
  it('drops the query values a failed query puts into its message', () => {
    const cause = Object.assign(new Error('connection refused'), { code: '08006' })
    const error = new Error(
      'Failed query: select * from "verification" where "identifier" = $1\nparams: sign-in-otp-researcher@khronist.example,123456:0',
      { cause },
    )
    const logged = JSON.stringify(safeError(error))
    expect(logged).not.toContain('researcher@khronist.example')
    expect(logged).not.toContain('123456')
    expect(logged).toContain('Failed query: select * from')
    expect(logged).toContain('08006')
  })

  it('keeps the message of a cause that is not a database error', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    })
    const logged = JSON.stringify(safeError(new Error('Failed query: select 1', { cause })))
    expect(logged).toContain('ECONNREFUSED 127.0.0.1:5432')
  })

  it('keeps only the code of a database cause, whose message can carry a value', () => {
    const cause = Object.assign(new Error('invalid input syntax for type uuid: "a@b.example"'), {
      code: '22P02',
    })
    const logged = JSON.stringify(safeError(new Error('Failed query: select 1', { cause })))
    expect(logged).not.toContain('a@b.example')
    expect(logged).toContain('22P02')
  })

  it('describes a value that is not an error without throwing', () => {
    expect(safeError('text').message).toBe('a non-error value was logged')
  })

  it('drops query values from a failed query wrapped as a cause', () => {
    const drizzle = new Error('Failed query: select 1\nparams: a@b.example,654321', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    })
    const logged = JSON.stringify(safeError(new Error('wrapped', { cause: drizzle })))
    expect(logged).not.toContain('a@b.example')
    expect(logged).not.toContain('654321')
    expect(logged).toContain('ECONNREFUSED')
  })

  it('keeps no line of the message in the stack, even one that looks like a frame', () => {
    const error = new Error('Failed query: insert\nparams: text\n    at secret@b.example')
    expect(JSON.stringify(safeError(error))).not.toContain('secret@b.example')
  })

  it('replaces the message of a database error with its code', () => {
    const error = Object.assign(new Error('invalid input syntax for type uuid: "a@b.example"'), {
      code: '22P02',
    })
    expect(safeError(error).message).toBe('PostgreSQL error 22P02')
  })
})
