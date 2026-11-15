import { utcDay } from '../services/budget.ts'

type Refusal = { ok: false; reason: 'address' | 'day'; retryAfterSeconds: number }

export type Reservation = { ok: true; release: () => void } | Refusal

export type CodeLimits = {
  reserve: (email: string, client: string) => Reservation
}

type CodeLimitOptions = {
  perDay: number
  perAddressAndClient: number
  perAddress: number
  windowMs: number
  now?: () => number
  today?: () => string
}

const gmailDomains = new Set(['gmail.com', 'googlemail.com'])

const addressOf = (email: string): string => {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@')
  const base = local.split('+')[0] ?? ''
  return gmailDomains.has(domain) ? `${base.replaceAll('.', '')}@gmail.com` : `${base}@${domain}`
}

const secondsUntilNextUtcDay = (now: number): number => {
  const date = new Date(now)
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
  return Math.ceil((next - now) / 1000)
}

type Send = { at: number; client: string }

export const createCodeLimits = (options: CodeLimitOptions): CodeLimits => {
  const now = options.now ?? Date.now
  const today = options.today ?? utcDay
  const sent = new Map<string, Send[]>()
  let day = today()
  let sentToday = 0

  const forget = (at: number) => {
    const current = today()
    if (current !== day) {
      day = current
      sentToday = 0
    }
    for (const [address, sends] of sent) {
      const recent = sends.filter((send) => send.at > at - options.windowMs)
      if (recent.length === 0) sent.delete(address)
      else sent.set(address, recent)
    }
  }

  const waitFor = (sends: Send[], at: number) =>
    Math.ceil(((sends[0]?.at ?? at) + options.windowMs - at) / 1000)

  return {
    reserve: (email, client) => {
      const at = now()
      forget(at)
      if (sentToday >= options.perDay) {
        return { ok: false, reason: 'day', retryAfterSeconds: secondsUntilNextUtcDay(at) }
      }
      const address = addressOf(email)
      const sends = sent.get(address) ?? []
      const fromClient = sends.filter((send) => send.client === client)
      if (fromClient.length >= options.perAddressAndClient) {
        return { ok: false, reason: 'address', retryAfterSeconds: waitFor(fromClient, at) }
      }
      if (sends.length >= options.perAddress) {
        return { ok: false, reason: 'address', retryAfterSeconds: waitFor(sends, at) }
      }
      const send = { at, client }
      sent.set(address, [...sends, send])
      sentToday += 1
      return {
        ok: true,
        release: () => {
          const current = sent.get(address)
          if (!current?.includes(send)) return
          sent.set(
            address,
            current.filter((other) => other !== send),
          )
          if (day === today()) sentToday = Math.max(0, sentToday - 1)
        },
      }
    },
  }
}
