import { z } from 'zod'
import { signatureSchema } from './common.ts'

export const signInCodeRequestSchema = z.object({
  email: z.email().max(254),
  type: z.literal('sign-in'),
})
export type SignInCodeRequest = z.infer<typeof signInCodeRequestSchema>

export const signInRequestSchema = z.object({
  email: z.email().max(254),
  otp: z.string().regex(/^\d{6}$/),
})
export type SignInRequest = z.infer<typeof signInRequestSchema>

export const updateUserRequestSchema = z.object({ name: signatureSchema })
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>

export const sessionResponseSchema = z
  .object({
    user: z.object({ id: z.string(), email: z.email(), name: z.string() }),
    canVerify: z.boolean(),
  })
  .nullable()
export type SessionResponse = z.infer<typeof sessionResponseSchema>
