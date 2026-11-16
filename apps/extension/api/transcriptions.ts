import {
  transcriptionSchema,
  type PatchLinesRequest,
  type Transcription,
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
