import {
  transcriptionSchema,
  type PatchLinesRequest,
  type Transcription,
  type VerifyRequest,
} from '@khronist/contracts'
import { sendSignedIn } from './client.ts'

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

export const verifyTranscription = async (
  transcription: Transcription,
  signature: string,
  signal: AbortSignal,
): Promise<Transcription> => {
  const body: VerifyRequest = signature ? { signature } : {}
  const response = await sendSignedIn(`/v1/transcriptions/${transcription.id}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return transcriptionSchema.parse(await response.json())
}
