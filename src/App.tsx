// App composition (WP-C integration seam). Wires the app store (compendium load,
// scanner, STT, transcript POST, pinning) into the mobile-first layout.
//
// Fake → real swap points live in src/state/useAppStore.ts (search `SWAP:`):
//   - createFakeScanner  → createScanner   (WP-A, '../matching')
//   - createFakeProvider → createProvider  (WP-B, '../stt')

import { useAppStore } from './state/useAppStore'
import { DetectionFeed } from './ui/DetectionFeed'
import { EntryDetail } from './ui/EntryDetail'
import { LoadingScreen } from './ui/LoadingScreen'
import { PinnedBar } from './ui/PinnedBar'
import { TopBar } from './ui/TopBar'
import { SignInGate } from './auth/SignInGate'

function AppInner() {
  const store = useAppStore()

  if (store.loading || store.loadError || !store.compendium) {
    return <LoadingScreen error={store.loadError} />
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <TopBar
        compendium={store.compendium}
        sttState={store.sttState}
        onToggleListening={store.toggleListening}
        onEndSession={store.endSession}
        provider={store.provider}
        onSetProvider={store.setProvider}
        lastTranscript={store.lastTranscript}
        onSelect={store.select}
      />

      <PinnedBar
        pinned={store.pinned}
        onOpen={store.select}
        onUnpin={store.togglePin}
      />

      <main className="flex-1 overflow-y-auto">
        <DetectionFeed feed={store.feed} onOpen={store.select} />
      </main>

      {store.selected && (
        <EntryDetail
          entry={store.selected}
          pinned={store.isPinned(store.selected.id)}
          onTogglePin={() => store.togglePin(store.selected!)}
          onClose={() => store.select(null)}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <SignInGate>
      <AppInner />
    </SignInGate>
  )
}
