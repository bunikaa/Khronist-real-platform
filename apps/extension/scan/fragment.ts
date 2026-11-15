import type { Box } from '@khronist/contracts'
import type { SelectionRect } from '@khronist/ui'
import type { Fragment } from '../messages.ts'

type Size = { width: number; height: number }

export type ScanRegion = { x: number; y: number; width: number; height: number }

export const scanRegion = (
  selection: SelectionRect,
  shown: SelectionRect,
  natural: Size,
): ScanRegion | null => {
  if (shown.width <= 0 || shown.height <= 0) return null
  const left = Math.max(selection.left, shown.left)
  const top = Math.max(selection.top, shown.top)
  const right = Math.min(selection.left + selection.width, shown.left + shown.width)
  const bottom = Math.min(selection.top + selection.height, shown.top + shown.height)
  if (right <= left || bottom <= top) return null

  const scaleX = natural.width / shown.width
  const scaleY = natural.height / shown.height
  const x = Math.floor((left - shown.left) * scaleX)
  const y = Math.floor((top - shown.top) * scaleY)
  const width = Math.min(Math.ceil((right - shown.left) * scaleX), natural.width) - x
  const height = Math.min(Math.ceil((bottom - shown.top) * scaleY), natural.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

export const regionBox = (region: ScanRegion, natural: Size): Box => ({
  x: region.x / natural.width,
  y: region.y / natural.height,
  w: region.width / natural.width,
  h: region.height / natural.height,
})

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const maxModelSide = 2576
export const maxModelPixels = 3_750_000
const maxPngBytes = 7 * 1024 * 1024
const shrinkStep = 0.8

export const fittedSize = (region: Size, scale = 1): Size => {
  const factor =
    Math.min(
      1,
      maxModelSide / Math.max(region.width, region.height),
      Math.sqrt(maxModelPixels / (region.width * region.height)),
    ) * scale
  return {
    width: Math.max(1, Math.floor(region.width * factor)),
    height: Math.max(1, Math.floor(region.height * factor)),
  }
}

const encodePng = async (scan: HTMLImageElement, region: ScanRegion, size: Size) => {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2d canvas is unavailable')
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    scan,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    size.width,
    size.height,
  )
  return canvas.convertToBlob({ type: 'image/png' })
}

export const cropFragment = async (
  scan: HTMLImageElement,
  region: ScanRegion,
): Promise<Fragment> => {
  let size = fittedSize(region)
  let blob = await encodePng(scan, region, size)
  for (let scale = shrinkStep; blob.size > maxPngBytes; scale *= shrinkStep) {
    size = fittedSize(region, scale)
    blob = await encodePng(scan, region, size)
  }
  const png = new Uint8Array(await blob.arrayBuffer())
  const scaled = size.width !== region.width || size.height !== region.height
  return {
    base64Png: toBase64(png),
    imageHash: await sha256Hex(png),
    box: regionBox(region, { width: scan.naturalWidth, height: scan.naturalHeight }),
    width: size.width,
    height: size.height,
    ...(scaled && { scaledFrom: { width: region.width, height: region.height } }),
  }
}
