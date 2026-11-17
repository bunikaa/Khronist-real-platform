import { useState } from 'react'

export const useCopy = (text: string | undefined) => {
  const [last, setLast] = useState<{ text: string; done: boolean }>()
  const copy = () => {
    if (text === undefined) return
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setLast({ text, done: true }),
        () => setLast({ text, done: false }),
      )
  }
  return {
    copied: last?.done === true && last.text === text,
    failed: last?.done === false && last.text === text,
    copy,
  }
}
