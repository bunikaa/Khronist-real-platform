export const runWithTimeout = async <T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> => {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out after ${ms} ms`)),
    ms,
  )
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    })
  })
  try {
    return await Promise.race([task(controller.signal), aborted])
  } finally {
    clearTimeout(timer)
  }
}
