import type { CiteRequest, Line, Shelfmark, Transcription } from '@khronist/contracts'

export type CitedTranscription = Pick<
  Transcription,
  'status' | 'lines' | 'verifiedBy' | 'verifiedSignature' | 'verifiedAt'
>

type CitationInput = Omit<CiteRequest, 'transcriptionId'> & {
  shelfmark: Shelfmark
  transcription: CitedTranscription
  accessedAt: Date
}

const kyivDate = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const uncertainMark = '[?]'
const attribution = 'Транскрипція: Хроніст (khronist.org)'
const unverifiedNotes = {
  draft: 'Чернетка, не підтверджена людиною.',
  disputed: 'Спірна версія, не підтверджена.',
}

const withPeriod = (part: string): string => (/[.?!…]$/.test(part) ? part : `${part}.`)

const collapseSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim()

const dstuReference = (shelfmark: Shelfmark, accessedAt: Date): string => {
  const { archive, fond, opys, sprava, folio, image, portalUrl } = shelfmark
  const parts = [
    archive,
    `Ф. ${fond}`,
    `Оп. ${opys}`,
    `Спр. ${sprava}`,
    ...(folio !== undefined ? [`Арк. ${folio}`] : image !== undefined ? [`Зобр. ${image}`] : []),
  ]
  const reference = parts.map(withPeriod).join(' ')
  if (portalUrl === undefined) return reference
  return `${reference} URL: ${portalUrl} (дата звернення: ${kyivDate.format(accessedAt)}).`
}

const shortReference = ({ archive, fond, opys, sprava, folio, image }: Shelfmark): string =>
  [
    archive,
    `ф. ${fond}`,
    `оп. ${opys}`,
    `спр. ${sprava}`,
    ...(folio !== undefined ? [`арк. ${folio}`] : image !== undefined ? [`зобр. ${image}`] : []),
  ].join(', ')

const escapeMarkdown = (text: string): string =>
  text
    .replace(/[\\`*_[\]<>#|~&]/g, '\\$&')
    .replace(/^(\d+)([.)])/, '$1\\$2')
    .replace(/^[-+=]/, '\\$&')

const markdownLinkTarget = (url: string): string =>
  new URL(url).href.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll('\\', '%5C')

const markdownReference = (shelfmark: Shelfmark): string => {
  const label = escapeMarkdown(shortReference(shelfmark))
  return shelfmark.portalUrl === undefined
    ? label
    : `[${label}](${markdownLinkTarget(shelfmark.portalUrl)})`
}

const lineText = (line: Line, marksUncertain: boolean): string =>
  collapseSpaces(
    marksUncertain && line.uncertain
      ? line.words
          .map((word) => (word.uncertain ? `${word.text} ${uncertainMark}` : word.text))
          .join(' ')
      : line.text,
  )

const markdownQuote = (lines: string[]): string => {
  const quoted = lines.map(escapeMarkdown)
  return quoted
    .map((line, index) => {
      if (line === '') return '>'
      const next = quoted[index + 1]
      return next !== undefined && next !== '' ? `> ${line}\\` : `> ${line}`
    })
    .join('\n')
}

const verifierOf = ({ verifiedBy, verifiedSignature }: CitedTranscription): string => {
  const name = verifiedBy?.name ?? ''
  const signature = verifiedSignature ?? ''
  if (signature === '' || signature === name) return name
  return name === '' ? `«${signature}»` : `${name} («${signature}»)`
}

const withoutBlankEnds = (lines: string[]): string[] => {
  const first = lines.findIndex((line) => line !== '')
  return first === -1 ? [] : lines.slice(first, lines.findLastIndex((line) => line !== '') + 1)
}

const verifiedNote = (transcription: CitedTranscription): string => {
  const verifier = verifierOf(transcription)
  const { verifiedAt } = transcription
  const confirmed = verifier === '' ? 'Підтверджено' : `Підтверджено: ${verifier}`
  const date = verifiedAt === undefined ? '' : `, ${kyivDate.format(new Date(verifiedAt))}`
  return `${attribution}, CC BY 4.0. ${confirmed}${date}.`
}

const transcriptionNote = (transcription: CitedTranscription, hasUncertainMarks: boolean) => {
  if (transcription.status === 'verified') return verifiedNote(transcription)
  const note = `${attribution}. ${unverifiedNotes[transcription.status]}`
  return hasUncertainMarks ? `${note} ${uncertainMark} — непевне прочитання.` : note
}

export const formatCitation = (input: CitationInput): string => {
  const { shelfmark, transcription, format, withTranscription, accessedAt } = input
  const reference =
    format === 'dstu'
      ? dstuReference(shelfmark, accessedAt)
      : format === 'markdown'
        ? markdownReference(shelfmark)
        : [shortReference(shelfmark), shelfmark.portalUrl].filter(Boolean).join('\n')
  if (!withTranscription) return reference

  const marksUncertain = transcription.status !== 'verified'
  const lines = withoutBlankEnds(transcription.lines.map((line) => lineText(line, marksUncertain)))
  if (lines.length === 0) return reference
  const hasUncertainMarks = marksUncertain && transcription.lines.some((line) => line.uncertain)
  const note = transcriptionNote(transcription, hasUncertainMarks)
  return format === 'markdown'
    ? [reference, markdownQuote(lines), escapeMarkdown(note)].join('\n\n')
    : [reference, lines.join('\n'), note].join('\n\n')
}
