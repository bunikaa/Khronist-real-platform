import { PanelHeader, strings } from '@khronist/ui'
import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import {
  fragmentFailedMessageSchema,
  fragmentMessageSchema,
  type SelectionCommand,
} from '../../messages.ts'
import { FirstRun, Profile, SignIn } from './account.tsx'
import { Result } from './result.tsx'
import { Failed, MissingPage, Reading, ReadyToRead, Selecting } from './screens.tsx'
import { activeTabId, useActivePage } from './useActivePage.ts'
import { useConfirm } from './useConfirm.ts'
import { useFirstRun } from './useFirstRun.ts'
import { useLineEditing } from './useLineEditing.ts'
import { sheetKey, usePageReadings } from './usePageReadings.ts'
import { useReading } from './useReading.ts'
import { useSession } from './useSession.ts'

const sendToActiveTab = async (command: SelectionCommand) => {
  const tabId = await activeTabId()
  if (tabId !== undefined) await browser.tabs.sendMessage(tabId, command).catch(() => undefined)
}

const startSelection = () => void sendToActiveTab({ type: 'start-selection' })
const cancelSelection = () => void sendToActiveTab({ type: 'cancel-selection' })

const useShortcut = () => {
  const [shortcut, setShortcut] = useState<string>()
  useEffect(() => {
    const read = () =>
      browser.commands.getAll().then(
        (commands) => {
          const assigned = commands.find((command) => command.name === 'open-panel')?.shortcut
          setShortcut(assigned || undefined)
        },
        () => setShortcut(undefined),
      )
    void read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])
  return shortcut
}

export const App = () => {
  const page = useActivePage()
  const shortcut = useShortcut()
  const { reading, start, retry, failSelection, cancel, replace, show } = useReading()
  const { session, refresh } = useSession()
  const { seen: firstRunSeen, finish: finishFirstRun } = useFirstRun()
  const [accountOpen, setAccountOpen] = useState(false)
  const openAccount = useCallback(() => setAccountOpen(true), [])
  const editing = useLineEditing({
    transcription: reading.phase === 'done' ? reading.transcription : undefined,
    session,
    onSaved: replace,
    onSignInNeeded: openAccount,
  })
  const confirm = useConfirm({
    transcription: reading.phase === 'done' ? reading.transcription : undefined,
    session,
    editing,
    onConfirmed: replace,
    onForbidden: refresh,
    shown: !accountOpen && page?.selecting !== true,
  })
  const selecting = page?.selecting === true
  const readings = usePageReadings(page?.shelfmark, reading.phase === 'idle' && page?.scan === true)
  const openSheet = page?.scan ? sheetKey(page.shelfmark) : undefined
  const shownSheet = reading.phase === 'idle' ? undefined : sheetKey(reading.shelfmark)
  const settled =
    !editing.editing &&
    !editing.unsaved &&
    !editing.problem &&
    !confirm.asking &&
    !confirm.sending &&
    (reading.phase === 'done' || reading.phase === 'failed')
  const anotherSheet = openSheet !== undefined && openSheet !== shownSheet && settled

  useEffect(() => {
    if (anotherSheet) cancel()
  }, [anotherSheet, cancel])

  useEffect(() => {
    const showReading = () => {
      finishFirstRun()
      setAccountOpen(false)
    }
    const onCommand = (command: string, tab?: { id?: number }) => {
      if (command !== 'open-panel') return
      void activeTabId().then((tabId) => {
        if (tab?.id === undefined || tab.id !== tabId) return
        showReading()
        startSelection()
      })
    }
    const onMessage = (message: unknown, sender: { tab?: { id?: number } }) => {
      const fragment = fragmentMessageSchema.safeParse(message)
      const failed = fragmentFailedMessageSchema.safeParse(message)
      if (!fragment.success && !failed.success) return
      void activeTabId().then((tabId) => {
        if (sender.tab?.id !== tabId) return
        showReading()
        if (fragment.success) start(fragment.data.fragment, fragment.data.shelfmark)
        if (failed.success) failSelection(failed.data.reason, failed.data.shelfmark)
      })
    }
    browser.commands.onCommand.addListener(onCommand)
    browser.runtime.onMessage.addListener(onMessage)
    return () => {
      browser.commands.onCommand.removeListener(onCommand)
      browser.runtime.onMessage.removeListener(onMessage)
    }
  }, [start, failSelection, finishFirstRun])

  useEffect(() => {
    if (!selecting || accountOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selecting, accountOpen])

  useEffect(() => {
    if (!accountOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [accountOpen])

  const closeAccount = () => setAccountOpen(false)

  const account = () =>
    session.status === 'signed-in' ? (
      <Profile
        user={session.user}
        shortcut={shortcut}
        onSaved={refresh}
        onSignedOut={closeAccount}
      />
    ) : (
      <SignIn onSignedIn={closeAccount} />
    )

  const screen = () => {
    if (selecting) return <Selecting onCancel={cancelSelection} />
    switch (reading.phase) {
      case 'idle':
        if (page === undefined) return null
        if (!page?.scan) return <MissingPage />
        return (
          <ReadyToRead
            onSelect={startSelection}
            shortcut={shortcut}
            readings={readings}
            onOpen={(transcription) => show(transcription, page.shelfmark)}
          />
        )
      case 'reading':
        return <Reading {...reading} onCancel={cancel} />
      case 'done':
        return (
          <Result
            transcription={reading.transcription}
            editing={editing}
            confirm={confirm}
            signedIn={session.status === 'signed-in'}
            onSelect={startSelection}
            onSignIn={openAccount}
          />
        )
      case 'failed':
        return <Failed {...reading} onSelect={startSelection} onRetry={retry} />
    }
  }

  const shelfmark = reading.phase === 'idle' ? page?.shelfmark : reading.shelfmark

  if (firstRunSeen === undefined) return null
  if (!firstRunSeen) {
    return (
      <main className="flex h-screen flex-col">
        <FirstRun
          shortcut={shortcut}
          onStart={finishFirstRun}
          onSignIn={() => {
            finishFirstRun()
            openAccount()
          }}
        />
      </main>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <PanelHeader
        shelfmark={shelfmark ?? undefined}
        account={{
          label:
            session.status === 'signed-in'
              ? strings.account.profileLabel
              : strings.account.signInLabel,
          open: accountOpen,
          onToggle: () => setAccountOpen(!accountOpen),
        }}
      />
      <main className="flex min-h-0 flex-1 flex-col">{accountOpen ? account() : screen()}</main>
    </div>
  )
}
