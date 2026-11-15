import { Resend } from 'resend'
import type { SendSignInCode } from './index.ts'

const subject = 'Код входу в Хроніст'

const body = (code: string) =>
  `Ваш код входу в Хроніст: ${code}\n\nКод діє 5 хвилин. Якщо ви не просили код, просто проігноруйте цей лист.`

export const createResendSender = (apiKey: string, from: string): SendSignInCode => {
  const resend = new Resend(apiKey)
  return async (email, code) => {
    const { error } = await resend.emails.send({ from, to: email, subject, text: body(code) })
    if (error) throw new Error(`Resend rejected the email: ${error.name}: ${error.message}`)
  }
}
