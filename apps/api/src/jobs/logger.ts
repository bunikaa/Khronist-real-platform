type LogFn = (details: object, message: string) => void

export type JobLogger = {
  info: LogFn
  warn: LogFn
  error: LogFn
  child: (bindings: Record<string, string>) => JobLogger
}
