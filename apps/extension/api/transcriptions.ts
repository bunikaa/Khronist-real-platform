import {
  archiumViewerUrlSchema,
  transcriptionSchema,
  type PatchLinesRequest,
  type Shelfmark,
  type Transcription,
  type VerifyRequest,
} from '@khronist/contracts'
import { send, sendSignedIn } from './client.ts'

export type LineChange = PatchLinesRequest['lines'][number]

export const saveLines = async (
  transcription: Transcription,
  lines: LineChange[],
  signal: AbortSignal,
): Promise<Transcription> => {
  const body: PatchLinesRequest = { baseVersion: transcription.version, lines }
  const response = await sendSignedIn(`/v1/transcriptions/${transcription.id}/lines`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return transcriptionSchema.parse(await response.json())
}

const sameImage = (opened: Shelfmark, page: Shelfmark) =>
  opened.image !== undefined &&
  opened.image === page.image &&
  opened.archive === page.archive &&
  opened.fond === page.fond &&
  opened.opys === page.opys &&
  opened.sprava === page.sprava

const linkForEmptyPage = (
  openedPage: Shelfmark | null,
  page: Shelfmark | undefined,
): string | undefined => {
  if (!openedPage || !page || page.portalUrl !== undefined || !sameImage(openedPage, page)) {
    return undefined
  }
  const link = archiumViewerUrlSchema.safeParse(openedPage.portalUrl)
  return link.success ? link.data : undefined
}

export const verifyTranscription = async (
  transcription: Transcription,
  signature: string,
  openedPage: Shelfmark | null,
  signal: AbortSignal,
): Promise<Transcription> => {
  const body: VerifyRequest = {
    signature: signature || undefined,
    portalUrl: linkForEmptyPage(openedPage, transcription.shelfmark),
  }
  const response = await sendSignedIn(`/v1/transcriptions/${transcription.id}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return transcriptionSchema.parse(await response.json())
}

export const loadTranscription = async (
  id: string,
  signal: AbortSignal,
): Promise<Transcription> => {
  const response = await send(`/v1/transcriptions/${id}`, { signal })
  return transcriptionSchema.parse(await response.json())
}
