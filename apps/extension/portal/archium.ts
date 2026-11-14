import { shelfmarkSchema, type Shelfmark } from '@khronist/contracts'

const archives: Record<string, string> = {
  'archium.cdiak.archives.gov.ua': 'ЦДІАК України',
}

export const archiumMatches = Object.keys(archives).map((host) => `https://${host}/*`)

const linkText = (root: ParentNode, hrefPrefix: string): string | undefined =>
  root.querySelector(`a[href^="${hrefPrefix}"]`)?.textContent?.trim()

export const findArchiumScan = (doc: Document): HTMLImageElement | null =>
  doc.querySelector<HTMLImageElement>('img#main-image')

const imageNumber = (doc: Document): number | undefined => {
  const src = findArchiumScan(doc)?.getAttribute('src')
  if (!src) return undefined
  const escaped = CSS.escape(src)
  const thumbnail = doc.querySelector(
    `#all-images img[data-observe-src="${escaped}"], #all-images img[src="${escaped}"]`,
  )
  const page = thumbnail?.closest('a')?.querySelector('[data-page]')?.getAttribute('data-page')
  return page ? Number(page) : undefined
}

export const readArchiumShelfmark = (doc: Document, url: URL): Shelfmark | null => {
  const archive = archives[url.hostname]
  if (!archive || !url.pathname.startsWith('/file-viewer/')) return null
  const details = doc.querySelector('.description-item .item-lists')
  if (!details) return null

  const parsed = shelfmarkSchema.safeParse({
    archive,
    fond: linkText(details, '/fonds/'),
    opys: linkText(details, '/inventories/'),
    sprava: linkText(details, '/files/'),
    image: imageNumber(doc),
    portal: 'archium',
    portalUrl: url.href,
  })
  return parsed.success ? parsed.data : null
}
