import { beforeEach, describe, expect, it } from 'vitest'
import { readArchiumShelfmark } from '../portal/archium.ts'
import fixture from './fixtures/archium-viewer.html?raw'

const viewerUrl = new URL('https://archium.cdiak.archives.gov.ua/file-viewer/131976#file-2834611')

describe('readArchiumShelfmark', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture
  })

  it('reads the shelfmark and the number of the image on screen', () => {
    expect(readArchiumShelfmark(document, viewerUrl)).toEqual({
      archive: 'ЦДІАК України',
      fond: '127',
      opys: '1078',
      sprava: '177',
      image: 4,
      portal: 'archium',
      portalUrl: viewerUrl.href,
    })
  })

  it('follows the image shown in the viewer, not the first thumbnail', () => {
    document.querySelector('#main-image')?.setAttribute('src', '/static/files/283/2834655.jpg')

    expect(readArchiumShelfmark(document, viewerUrl)).toMatchObject({
      image: 1,
      portalUrl: 'https://archium.cdiak.archives.gov.ua/file-viewer/131976#file-2834655',
    })
  })

  it.each([
    ['a stale image', 'https://archium.cdiak.archives.gov.ua/file-viewer/131976#file-2834655'],
    ['no image', 'https://archium.cdiak.archives.gov.ua/file-viewer/131976'],
    [
      'a query and another anchor',
      'https://archium.cdiak.archives.gov.ua/file-viewer/131976?x=1#tag-images',
    ],
    [
      'the route with a trailing slash',
      'https://archium.cdiak.archives.gov.ua/file-viewer/131976/#file-2834655',
    ],
  ])('links the image on screen when the address names %s', (_case, address) => {
    expect(readArchiumShelfmark(document, new URL(address))?.portalUrl).toBe(viewerUrl.href)
  })

  it('reads no link when the thumbnail of the image on screen has no viewer target', () => {
    document
      .querySelector('[data-target-link="#file-2834611"]')
      ?.removeAttribute('data-target-link')

    expect(readArchiumShelfmark(document, viewerUrl)).toMatchObject({ image: 4 })
    expect(readArchiumShelfmark(document, viewerUrl)?.portalUrl).toBeUndefined()
  })

  it('reads nothing outside the viewer or on unknown hosts', () => {
    expect(
      readArchiumShelfmark(
        document,
        new URL('https://archium.cdiak.archives.gov.ua/files/131976/'),
      ),
    ).toBeNull()
    expect(
      readArchiumShelfmark(document, new URL('https://example.org/file-viewer/131976')),
    ).toBeNull()
    expect(
      readArchiumShelfmark(
        document,
        new URL('http://archium.cdiak.archives.gov.ua/file-viewer/131976'),
      ),
    ).toBeNull()
  })

  it('reads nothing until the viewer has rendered the case details', () => {
    document.body.innerHTML = '<div class="file-viewer"></div>'

    expect(readArchiumShelfmark(document, viewerUrl)).toBeNull()
  })

  it('reads nothing when the image on screen is not in the strip', () => {
    document.querySelector('#main-image')?.setAttribute('src', '/static/files/999/9999999.jpg')

    expect(readArchiumShelfmark(document, viewerUrl)).toBeNull()
  })
})
