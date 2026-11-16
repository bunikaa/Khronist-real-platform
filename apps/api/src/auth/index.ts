import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, customSession, emailOTP } from 'better-auth/plugins'
import type { FastifyBaseLogger } from 'fastify'
import type { Database } from '../db/client.ts'
import { account, session, user, verification } from '../db/schema.ts'
import { verifierCheck } from './session.ts'

export type SendSignInCode = (email: string, code: string) => Promise<void>

export type AuthOptions = {
  db: Database
  secret: string
  baseURL: string
  sendCode: SendSignInCode
  trustedOrigins: string[]
  verifierEmails: string[]
  clientIpHeader: string | undefined
  log: FastifyBaseLogger
}

const anyExtension = 'chrome-extension://*'

export const createAuth = (options: AuthOptions) => {
  const isVerifier = verifierCheck(options.verifierEmails)
  return betterAuth({
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [...options.trustedOrigins, anyExtension],
    onAPIError: { throw: true },
    logger: {
      log: (level, message: unknown, ...args: unknown[]) => {
        const err = [message, ...args].find((arg) => arg instanceof Error)
        options.log[level](
          { ...(err && { err }), source: 'better-auth' },
          typeof message === 'string' ? message : 'better-auth error',
        )
      },
    },
    advanced: {
      disableOriginCheck: false,
      ...(options.clientIpHeader !== undefined && {
        ipAddress: { ipAddressHeaders: [options.clientIpHeader] },
      }),
    },
    plugins: [
      emailOTP({
        storeOTP: 'encrypted',
        sendVerificationOTP: async ({ email, otp }) => {
          void options
            .sendCode(email, otp)
            .catch((error: unknown) =>
              options.log.error({ err: error }, 'could not send the sign-in code'),
            )
        },
      }),
      bearer({ requireSignature: true }),
      customSession(async ({ user, session }) => ({
        user,
        session,
        canVerify: isVerifier(user.email),
      })),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
