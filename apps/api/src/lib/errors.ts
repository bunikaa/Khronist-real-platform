export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

type PgViolation = { code: string; constraint: string | undefined }

export const findPgViolation = (error: unknown): PgViolation | undefined => {
  let current: unknown = error
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string' ? current.constraint : undefined
      return { code: current.code, constraint }
    }
    current = current.cause
  }
  return undefined
}

export const isUniqueViolation = (error: unknown): boolean => findPgViolation(error)?.code === '23505'
