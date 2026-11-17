import {
  archiumHosts,
  archiumViewerHost,
  shelfmarkSchema,
  type ArchiumHost,
  type Shelfmark,
} from '@khronist/contracts'

const archives: Record<ArchiumHost, string> = {
  'archium.cdiak.archives.gov.ua': 'ЦДІАК України',
}

export const archiumMatches = archiumHosts.map((host) => `https://${host}/*`)

const linkText = (root: ParentNode, hrefPrefix: string): string | undefined =>
  root.querySelector(`a[href^="${hrefPrefix}"]`)?.textContent?.trim()

export const findArchiumScan = (doc: Document): HTMLImageElement | null =>
  doc.querySelector<HTMLImageElement>('img#main-image')

const shownThumbnail = (doc: Document): Element | null => {
  const src = findArchiumScan(doc)?.getAttribute('src')
  if (!src) return null
  const escaped = CSS.escape(src)
  return doc.querySelector(
    `#all-images img[data-observe-src="${escaped}"], #all-images img[src="${escaped}"]`,
  )
}

const imageNumber = (thumbnail: Element | null): number | undefined => {
  const page = thumbnail?.closest('a')?.querySelector('[data-page]')?.getAttribute('data-page')
  return page ? Number(page) : undefined
}

const viewerLink = (url: URL, thumbnail: Element | null): string | undefined => {
  const target = thumbnail?.getAttribute('data-target-link')
  if (!target || !/^#file-\d+$/.test(target)) return undefined
  return `${url.origin}${url.pathname.replace(/\/$/, '')}${target}`
}

export const readArchiumShelfmark = (doc: Document, url: URL): Shelfmark | null => {
  const host = archiumViewerHost(url)
  if (!host) return null
  const details = doc.querySelector('.description-item .item-lists')
  if (!details) return null

  const thumbnail = shownThumbnail(doc)
  const parsed = shelfmarkSchema.safeParse({
    archive: archives[host],
    fond: linkText(details, '/fonds/'),
    opys: linkText(details, '/inventories/'),
    sprava: linkText(details, '/files/'),
    image: imageNumber(thumbnail),
    portal: 'archium',
    portalUrl: viewerLink(url, thumbnail),
  })
  return parsed.success ? parsed.data : null
}
