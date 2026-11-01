import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/lib/errors.ts'
import { decodePng, maxImageBytes, maxImagePixels, maxImageSide } from '../src/lib/image.ts'
import { makePng } from './helpers.ts'

const thrown = (action: () => unknown): ApiError => {
  try {
    action()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected an ApiError')
}

describe('decodePng', () => {
  it('reads the size and hashes the decoded bytes', () => {
    const png = makePng(640, 480)
    const decoded = decodePng(png.toString('base64'))
    expect(decoded.width).toBe(640)
    expect(decoded.height).toBe(480)
    expect(decoded.sha256).toBe(createHash('sha256').update(png).digest('hex'))
  })

  it('rejects data without the PNG signature', () => {
    const error = thrown(() => decodePng(Buffer.from('GIF89a'.padEnd(40, 'x')).toString('base64')))
    expect([error.statusCode, error.code]).toEqual([400, 'bad_image'])
  })

  it('rejects a zero or oversized dimension', () => {
    expect(thrown(() => decodePng(makePng(0, 10).toString('base64'))).code).toBe('bad_image')
    expect(thrown(() => decodePng(makePng(maxImageSide + 1, 10).toString('base64'))).code).toBe('bad_image')
  })

  it('rejects an image above the size limit with too_large', () => {
    const big = Buffer.concat([makePng(10, 10), Buffer.alloc(maxImageBytes)])
    const error = thrown(() => decodePng(big.toString('base64')))
    expect([error.statusCode, error.code]).toEqual([413, 'too_large'])
  })
})

describe('decodePng hardening', () => {
  const withoutEnd = () => makePng(10, 10).subarray(0, 33)

  it('rejects a file that is cut off before the end marker', () => {
    expect(thrown(() => decodePng(withoutEnd().toString('base64'))).code).toBe('bad_image')
  })

  it('rejects a header-only file that claims a huge size', () => {
    const png = makePng(maxImageSide, maxImageSide)
    expect(thrown(() => decodePng(png.toString('base64'))).code).toBe('bad_image')
  })

  it('rejects an image above the pixel limit even when each side is allowed', () => {
    expect(maxImagePixels).toBeLessThan(maxImageSide * maxImageSide)
    const png = makePng(10000, 6000)
    expect(thrown(() => decodePng(png.toString('base64'))).code).toBe('bad_image')
  })

  it('rejects a wrong header chunk length', () => {
    const png = Buffer.from(makePng(10, 10))
    png.writeUInt32BE(12, 8)
    expect(thrown(() => decodePng(png.toString('base64'))).code).toBe('bad_image')
  })

  it('rejects an oversized base64 string before decoding it', () => {
    const error = thrown(() => decodePng('A'.repeat(maxImageBytes * 2)))
    expect([error.statusCode, error.code]).toEqual([413, 'too_large'])
  })

  it('accepts an image exactly at the pixel limit', () => {
    const png = makePng(10000, 5000)
    expect(decodePng(png.toString('base64')).width).toBe(10000)
  })
})
