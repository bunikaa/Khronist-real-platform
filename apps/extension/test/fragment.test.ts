import { boxSchema } from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import { regionBox, scanRegion, sha256Hex, toBase64 } from '../scan/fragment.ts'

const natural = { width: 3000, height: 2481 }
const shown = { left: 100, top: 50, width: 1000, height: 827 }

describe('scanRegion', () => {
  it('maps the selection on screen to pixels of the original scan', () => {
    expect(scanRegion({ left: 200, top: 150, width: 300, height: 100 }, shown, natural)).toEqual({
      x: 300,
      y: 300,
      width: 900,
      height: 300,
    })
  })

  it('keeps only the part of the selection that lies on the scan', () => {
    expect(scanRegion({ left: 0, top: 0, width: 400, height: 200 }, shown, natural)).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 450,
    })
    expect(scanRegion({ left: 1000, top: 800, width: 500, height: 500 }, shown, natural)).toEqual({
      x: 2700,
      y: 2250,
      width: 300,
      height: 231,
    })
  })

  it('returns nothing when the selection misses the scan', () => {
    expect(scanRegion({ left: 0, top: 0, width: 50, height: 50 }, shown, natural)).toBeNull()
    expect(
      scanRegion({ left: 200, top: 150, width: 300, height: 100 }, { ...shown, width: 0 }, natural),
    ).toBeNull()
  })
})

describe('regionBox', () => {
  it('stores the region in fractions of the scan size, as the contract requires', () => {
    const box = regionBox({ x: 1500, y: 0, width: 1500, height: 2481 }, natural)

    expect(box).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    expect(boxSchema.safeParse(box).success).toBe(true)
  })
})

describe('encoding', () => {
  const bytes = new TextEncoder().encode('abc')

  it('hashes the PNG bytes with SHA-256 in hex, like the API does', async () => {
    expect(await sha256Hex(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('encodes bytes to base64, including inputs longer than one chunk', () => {
    expect(toBase64(bytes)).toBe('YWJj')

    const long = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i % 256)
    expect(toBase64(long)).toBe(Buffer.from(long).toString('base64'))
  })
})
