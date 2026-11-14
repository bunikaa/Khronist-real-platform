import { PanelHeader } from '@khronist/ui'
import { useActivePage } from './useActivePage.ts'

export const App = () => {
  const shelfmark = useActivePage()
  return <PanelHeader shelfmark={shelfmark ?? undefined} />
}
