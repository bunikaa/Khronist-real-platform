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

const pgCode = (error: unknown): string | undefined => {
  let current: unknown = error
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current.code
    }
    current = current.cause
  }
  return undefined
}

export const isUniqueViolation = (error: unknown): boolean => pgCode(error) === '23505'
