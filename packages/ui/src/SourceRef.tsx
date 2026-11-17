type SourceRefProps = {
  number: number
  title: string
  href?: string
  note: string
}

export const SourceRef = ({ number, title, href, note }: SourceRefProps) => (
  <li className="flex gap-2">
    <span className="mt-px w-5 shrink-0 font-mono text-mono-11 text-primary">{`[${number}]`}</span>
    <span className="flex min-w-0 flex-col break-words">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-body-12 text-ink-muted underline-offset-2 hover:underline"
        >
          {title}
        </a>
      ) : (
        <span className="text-body-12 text-ink-muted">{title}</span>
      )}
      <span className="font-mono text-mono-10 text-ink-muted">{note}</span>
    </span>
  </li>
)
