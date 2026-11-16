import {
  maxSignatureLength,
  signInCodeRequestSchema,
  signInRequestSchema,
  updateUserRequestSchema,
} from '@khronist/contracts'
import { Button, SectionLabel, SettingsRow, StatusBar, TextField, strings } from '@khronist/ui'
import { useEffect, useState, type FormEvent } from 'react'
import { browser } from 'wxt/browser'
import { requestCode, saveName, signIn, signOut, type SessionUser } from '../../api/auth.ts'
import { ApiFailure } from '../../api/client.ts'

type Action = () => void
type Problem = { type: 'warning' | 'error'; message: string }

const resendSeconds = 60
const shortcutsPage = 'chrome://extensions/shortcuts'

const problemOf = (error: unknown): Problem => {
  if (error instanceof ApiFailure) return { type: 'warning', message: error.message }
  if (error instanceof TypeError) return { type: 'error', message: strings.read.offline }
  return { type: 'error', message: strings.read.badResponse }
}

const ProblemBar = ({ problem, onDismiss }: { problem?: Problem; onDismiss: Action }) =>
  problem ? (
    <StatusBar
      type={problem.type}
      message={problem.message}
      action={strings.account.dismiss}
      onAction={onDismiss}
    />
  ) : null

type FirstRunProps = { shortcut: string | undefined; onStart: Action; onSignIn: Action }

export const FirstRun = ({ shortcut, onStart, onSignIn }: FirstRunProps) => {
  const text = strings.account.firstRun
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-8">
      <h1 className="font-display text-brand-display text-base-content">{strings.brand}</h1>
      <p className="text-body-14 text-ink-muted">{text.intro}</p>
      <ol className="flex flex-col gap-3">
        {text.steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="w-3.5 shrink-0 font-mono text-mono-11 text-ink-muted">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="text-body-13 text-base-content">{step}</span>
          </li>
        ))}
      </ol>
      {shortcut && (
        <p className="flex items-center gap-2 text-body-12 text-ink-muted">
          {text.shortcut}
          <kbd className="rounded-field border border-rule bg-base-200 px-1.5 py-0.5 font-mono text-mono-11 text-base-content">
            {strings.shortcutKeys(shortcut)}
          </kbd>
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button size="md" className="w-full justify-start px-4" onClick={onStart}>
          {text.start}
        </Button>
        <Button kind="ghost" size="md" className="w-full justify-start px-4" onClick={onSignIn}>
          {text.signIn}
        </Button>
      </div>
      <p className="text-body-12 text-ink-muted">{text.why}</p>
    </div>
  )
}

const useCountdown = () => {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds((left) => left - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])
  return { seconds, restart: () => setSeconds(resendSeconds) }
}

export const SignIn = ({ onSignedIn }: { onSignedIn: Action }) => {
  const text = strings.account.signIn
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem>()
  const countdown = useCountdown()

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setProblem(undefined)
    try {
      await task()
    } catch (error) {
      setProblem(problemOf(error))
    } finally {
      setBusy(false)
    }
  }

  const sendTo = (address: string) =>
    void run(async () => {
      await requestCode(address)
      setSentTo(address)
      setCode('')
      countdown.restart()
    })

  const send = (event: FormEvent) => {
    event.preventDefault()
    sendTo(email.trim())
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!sentTo) return
    void run(async () => {
      await signIn(sentTo, code)
      onSignedIn()
    })
  }

  const locked = sentTo !== undefined
  const emailReady = signInCodeRequestSchema.shape.email.safeParse(email.trim()).success
  const codeReady = signInRequestSchema.shape.otp.safeParse(code).success

  return (
    <>
      <ProblemBar problem={problem} onDismiss={() => setProblem(undefined)} />
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-4 px-3 py-6">
          <h1 className="text-heading-20 text-base-content">{text.title}</h1>
          <p className="text-body-13 text-ink-muted">{text.intro}</p>
          <form className="flex flex-col gap-4" onSubmit={send}>
            <TextField
              label={text.email}
              type="email"
              autoComplete="email"
              placeholder={text.emailPlaceholder}
              readOnly={locked || busy}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button
              type="submit"
              size="md"
              className="w-full justify-start px-4"
              disabled={busy || locked || !emailReady}
            >
              {text.send}
            </Button>
          </form>
          {sentTo && (
            <>
              <hr className="border-rule" />
              <form className="flex flex-col gap-2 rounded-box bg-base-200 p-3" onSubmit={submit}>
                <SectionLabel>{text.sent}</SectionLabel>
                <p className="wrap-anywhere text-body-13 text-base-content">
                  {text.sentBody(sentTo)}
                </p>
                <TextField
                  label={text.code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <Button
                  type="submit"
                  size="md"
                  className="w-full justify-start px-4"
                  disabled={busy || !codeReady}
                >
                  {text.submit}
                </Button>
                {countdown.seconds > 0 ? (
                  <p className="font-mono text-mono-11 text-ink-muted">
                    {text.resendIn(countdown.seconds)}
                  </p>
                ) : (
                  <Button
                    kind="ghost"
                    className="self-start"
                    disabled={busy}
                    onClick={() => sendTo(sentTo)}
                  >
                    {text.resend}
                  </Button>
                )}
                <Button
                  kind="ghost"
                  className="self-start"
                  disabled={busy}
                  onClick={() => setSentTo(undefined)}
                >
                  {text.otherEmail}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  )
}

type ProfileProps = {
  user: SessionUser
  shortcut: string | undefined
  onSaved: () => Promise<void>
  onSignedOut: Action
}

export const Profile = ({ user, shortcut, onSaved, onSignedOut }: ProfileProps) => {
  const text = strings.account.profile
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(user.name)
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem>()

  const toggleEditing = () => {
    setDraft(user.name)
    setInvalid(false)
    setEditing(!editing)
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    const parsed = updateUserRequestSchema.safeParse({ name: draft })
    if (!parsed.success) {
      setInvalid(true)
      setProblem({ type: 'warning', message: text.signatureInvalid })
      return
    }
    setBusy(true)
    setProblem(undefined)
    saveName(parsed.data.name)
      .then(onSaved)
      .then(() => setEditing(false))
      .catch((error: unknown) => setProblem(problemOf(error)))
      .finally(() => setBusy(false))
  }

  const leave = () => {
    onSignedOut()
    void signOut()
  }

  return (
    <>
      <ProblemBar problem={problem} onDismiss={() => setProblem(undefined)} />
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-4 px-3 py-4">
          <div className="flex items-center gap-3">
            <span className="size-9 shrink-0 rounded-full bg-base-300" aria-hidden />
            <div className="flex min-w-0 flex-col gap-1">
              <span
                className={`truncate text-heading-16 ${user.name ? 'text-base-content' : 'text-ink-muted'}`}
              >
                {user.name || text.noName}
              </span>
              <span className="truncate font-mono text-mono-11 text-ink-muted">{user.email}</span>
            </div>
          </div>
          <div className="flex flex-col">
            <SettingsRow
              label={text.signature}
              value={user.name || text.signatureMissing}
              expanded={editing}
              disabled={busy}
              onSelect={toggleEditing}
            />
            {editing && (
              <form className="flex flex-col gap-2 border-b border-rule py-3" onSubmit={save}>
                <TextField
                  label={text.signature}
                  autoComplete="name"
                  maxLength={maxSignatureLength}
                  invalid={invalid}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setInvalid(false)
                  }}
                />
                <p className="text-body-12 text-ink-muted">{text.signatureHint}</p>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>
                    {text.save}
                  </Button>
                  <Button kind="ghost" disabled={busy} onClick={toggleEditing}>
                    {text.cancel}
                  </Button>
                </div>
              </form>
            )}
            <SettingsRow
              label={text.shortcut}
              value={shortcut ? strings.shortcutKeys(shortcut) : text.shortcutMissing}
              onSelect={() => void browser.tabs.create({ url: shortcutsPage })}
            />
          </div>
          <Button
            kind="ghost"
            size="md"
            className="self-start px-4"
            disabled={busy}
            onClick={leave}
          >
            {text.signOut}
          </Button>
        </div>
      </div>
    </>
  )
}
