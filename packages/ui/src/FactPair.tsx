type Fact = {
  label: string
  note?: string
  value: string
}

type FactPairProps = {
  facts: [Fact, Fact]
}

export const FactPair = ({ facts }: FactPairProps) => (
  <dl className="grid grid-cols-2 divide-x divide-rule">
    {facts.map(({ label, note, value }, index) => (
      <div key={index} className="flex min-w-0 flex-col gap-0.5 p-3 break-words">
        <dt className="text-label-section text-ink-muted uppercase">{label}</dt>
        {note && <dd className="text-body-12 text-ink-muted">{note}</dd>}
        <dd className="text-label-13">{value}</dd>
      </div>
    ))}
  </dl>
)
