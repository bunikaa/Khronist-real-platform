import { z } from 'zod'

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
