export const apiOriginFor = (mode: string | undefined): string =>
  mode === 'development' ? 'http://localhost:3000' : 'https://api.khronist.org'

export const apiOrigin = apiOriginFor(import.meta.env?.MODE)
