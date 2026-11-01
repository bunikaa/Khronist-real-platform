import type { Line } from './common.ts'
import type { HtrVisionOutput } from './htr.ts'

export const visionToLines = (output: HtrVisionOutput): Line[] => {
  const n = output.lines.length
  return output.lines.map((line, i) => ({
    idx: i,
    text: line.text,
    box: { x: 0, y: i / n, w: 1, h: 1 / n },
    boxSource: 'estimated',
    uncertain: line.words.some((w) => w.uncertain),
    words: line.words,
  }))
}
