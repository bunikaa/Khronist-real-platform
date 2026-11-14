import { recognitionEventSchema, type RecognitionEvent } from '@khronist/contracts'

export const parseEventBlock = (block: string): RecognitionEvent | null => {
  let name = ''
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart())
  }
  if (!name || data.length === 0) return null
  try {
    const parsed = recognitionEventSchema.safeParse({
      event: name,
      data: JSON.parse(data.join('\n')),
    })
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<RecognitionEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
      let end = buffer.indexOf('\n\n')
      while (end !== -1) {
        const event = parseEventBlock(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        if (event) yield event
        end = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}
