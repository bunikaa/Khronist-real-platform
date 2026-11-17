type SourceRefProps = {
  index: number
  title: string
  href?: string
  note?: string
}

export const SourceRef = ({ index, title, href, note }: SourceRefProps) => (
  <div className="flex items-baseline gap-2">
    <span className="shrink-0 font-mono text-mono-11 text-primary">{`[${index}]`}</span>
    <span className="flex min-w-0 flex-col text-body-12 break-words text-ink-muted">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
          {title}
        </a>
      ) : (
        <span>{title}</span>
      )}
      {note && <span>{note}</span>}
    </span>
  </div>
)
