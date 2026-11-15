export const runWithTimeout = async <T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  parent?: AbortSignal | undefined,
): Promise<T> => {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out after ${ms} ms`)),
    ms,
  )
  const onParentAbort = () => controller.abort(parent?.reason)
  if (parent?.aborted) onParentAbort()
  else parent?.addEventListener('abort', onParentAbort, { once: true })
  const aborted = new Promise<never>((_, reject) => {
    if (controller.signal.aborted) reject(controller.signal.reason)
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    })
  })
  try {
    return await Promise.race([task(controller.signal), aborted])
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', onParentAbort)
  }
}
