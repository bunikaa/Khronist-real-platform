type Change = { newValue?: unknown; oldValue?: unknown }
type ChangeListener = (changes: Record<string, Change>, areaName: string) => void

const listeners = new Set<ChangeListener>()
const notifications = new Set<ReturnType<typeof setTimeout>>()

const area = (name: string) => {
  const items = new Map<string, unknown>()
  const notify = (changes: Record<string, Change>) => {
    const timer = setTimeout(() => {
      notifications.delete(timer)
      for (const listener of listeners) listener(changes, name)
    }, 0)
    notifications.add(timer)
  }
  return {
    items,
    get: async (key: string): Promise<Record<string, unknown>> =>
      items.has(key) ? { [key]: items.get(key) } : {},
    set: async (values: Record<string, unknown>) => {
      const changes: Record<string, Change> = {}
      for (const [key, newValue] of Object.entries(values)) {
        changes[key] = { oldValue: items.get(key), newValue }
        items.set(key, newValue)
      }
      notify(changes)
    },
    remove: async (key: string) => {
      if (!items.has(key)) return
      const oldValue = items.get(key)
      items.delete(key)
      notify({ [key]: { oldValue } })
    },
  }
}

export const fakeStorage = {
  session: area('session'),
  local: area('local'),
  onChanged: {
    addListener: (listener: ChangeListener) => listeners.add(listener),
    removeListener: (listener: ChangeListener) => listeners.delete(listener),
  },
}

export const resetFakeStorage = () => {
  for (const timer of notifications) clearTimeout(timer)
  notifications.clear()
  fakeStorage.session.items.clear()
  fakeStorage.local.items.clear()
}
