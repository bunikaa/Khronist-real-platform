import type { Shelfmark, Transcription } from '@khronist/contracts'
import { useEffect, useState } from 'react'
import { lookupPage } from '../../api/pages.ts'
import { loadTranscription } from '../../api/transcriptions.ts'

const lookupTimeoutMs = 15_000

export type PageReadings =
  | { status: 'unknown' }
  | { status: 'found'; total: number; verified: number; transcriptions: Transcription[] }

type Found = Omit<Extract<PageReadings, { status: 'found' }>, 'status'>

export const sheetKey = (shelfmark: Shelfmark | null | undefined) =>
  shelfmark
    ? [
        shelfmark.archive,
        shelfmark.fond,
        shelfmark.opys,
        shelfmark.sprava,
        shelfmark.folio ?? '',
        shelfmark.image ?? '',
      ].join('|')
    : undefined

const readingsOf = async (shelfmark: Shelfmark, signal: AbortSignal): Promise<Found> => {
  const summaries = (await lookupPage(shelfmark, signal)).page?.transcriptions ?? []
  const loaded = await Promise.allSettled(summaries.map(({ id }) => loadTranscription(id, signal)))
  return {
    total: summaries.length,
    verified: summaries.filter(({ status }) => status === 'verified').length,
    transcriptions: loaded.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    ),
  }
}

export const usePageReadings = (
  shelfmark: Shelfmark | null | undefined,
  active: boolean,
): PageReadings => {
  const key = sheetKey(shelfmark)
  const [found, setFound] = useState<Found & { key: string }>()

  useEffect(() => {
    if (!shelfmark || !key || !active) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), lookupTimeoutMs)
    const settle = (readings?: Found) => {
      if (controller.signal.reason === 'left') return
      setFound(readings && !controller.signal.aborted ? { key, ...readings } : undefined)
    }
    readingsOf(shelfmark, controller.signal)
      .then(settle, () => settle())
      .finally(() => clearTimeout(timer))
    return () => controller.abort('left')
  }, [key, active])

  return found && found.key === key ? { status: 'found', ...found } : { status: 'unknown' }
}
