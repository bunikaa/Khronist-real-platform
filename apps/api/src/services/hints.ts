import type { Hints } from '@khronist/contracts'

export const hintValues = (hints: Hints | undefined) => ({
  language: hints?.language ?? 'unknown',
  period: hints?.period ?? 'unknown',
  documentType: hints?.documentType ?? 'unknown',
})

export const isRussianOrUnmarked = (hints: Hints | undefined): boolean =>
  hints?.language === undefined || hints.language === 'ru'
