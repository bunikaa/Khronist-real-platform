import { createHash } from 'node:crypto'
import { ApiError } from './errors.ts'

export const maxImageBytes = 8 * 1024 * 1024
export const maxImageSide = 12000
export const maxImagePixels = 50_000_000
const maxBase64Length = Math.ceil(maxImageBytes / 3) * 4 + 8

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const pngEnd = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

export type DecodedImage = {
  bytes: Buffer
  width: number
  height: number
  sha256: string
}

export const decodePng = (base64: string): DecodedImage => {
  if (base64.length > maxBase64Length) {
    throw new ApiError(413, 'too_large', 'Зображення завелике')
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length > maxImageBytes) {
    throw new ApiError(413, 'too_large', 'Зображення завелике')
  }
  const looksLikePng =
    bytes.length >= 45 &&
    bytes.subarray(0, 8).equals(pngSignature) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.subarray(bytes.length - pngEnd.length).equals(pngEnd)
  if (!looksLikePng) {
    throw new ApiError(400, 'bad_image', 'Очікується зображення у форматі PNG')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const sizeOk =
    width >= 1 &&
    height >= 1 &&
    width <= maxImageSide &&
    height <= maxImageSide &&
    width * height <= maxImagePixels
  if (!sizeOk) {
    throw new ApiError(400, 'bad_image', 'Недопустимі розміри зображення')
  }
  return { bytes, width, height, sha256: createHash('sha256').update(bytes).digest('hex') }
}
