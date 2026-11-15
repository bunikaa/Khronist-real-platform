import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, emailOTP } from 'better-auth/plugins'
import type { FastifyBaseLogger } from 'fastify'
import type { Database } from '../db/client.ts'
import { account, session, user, verification } from '../db/schema.ts'

export type SendSignInCode = (email: string, code: string) => Promise<void>

export type AuthOptions = {
  db: Database
  secret: string
  baseURL: string
  sendCode: SendSignInCode
  trustedOrigins: string[]
  clientIpHeader: string | undefined
  log: FastifyBaseLogger
}

const anyExtension = 'chrome-extension://*'

export const createAuth = (options: AuthOptions) =>
  betterAuth({
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [...options.trustedOrigins, anyExtension],
    advanced: {
      disableOriginCheck: false,
      ...(options.clientIpHeader !== undefined && {
        ipAddress: { ipAddressHeaders: [options.clientIpHeader] },
      }),
    },
    plugins: [
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          void options
            .sendCode(email, otp)
            .catch((error: unknown) =>
              options.log.error({ err: error }, 'could not send the sign-in code'),
            )
        },
      }),
      bearer(),
    ],
  })

export type Auth = ReturnType<typeof createAuth>
