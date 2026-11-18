import type { z } from 'zod'
import { ApiError } from './errors.ts'

export const cursorCodec = <Cursor>(schema: z.ZodType<Cursor>, rejection: string) => ({
  encode: (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url'),
  decode: (value: string): Cursor => {
    try {
      return schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    } catch {
      throw new ApiError(400, 'bad_request', rejection)
    }
  },
})
