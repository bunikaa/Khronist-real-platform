export const bearerToken = (header: string | undefined): string =>
  header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
