import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyRequest } from 'fastify'
import { ApiError } from '../lib/errors.ts'
import type { Auth } from './index.ts'

type SessionUser = { id: string; email: string }

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser: SessionUser | null
  }
}

const unauthorized = () => new ApiError(401, 'unauthorized', 'Потрібен вхід')

export const requireSession = (auth: Auth) => async (request: FastifyRequest) => {
  const found = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
  if (!found) throw unauthorized()
  request.sessionUser = { id: found.user.id, email: found.user.email }
}

export const signedInUser = (request: FastifyRequest): SessionUser => {
  if (!request.sessionUser) throw unauthorized()
  return request.sessionUser
}

export const verifierCheck = (emails: string[]) => {
  const verifiers = new Set(emails.map((email) => email.toLowerCase()))
  return (email: string) => verifiers.has(email.toLowerCase())
}
