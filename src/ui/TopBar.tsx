// Sticky top bar: listening status + mic toggle, a dev provider toggle for the
// Soniox-vs-Deepgram A/B, and the prominent manual search box beneath them.

import type { Compendium } from '../compendium/loader'
import type { CompendiumEntry } from '../compendium/types'
import type { SttProviderName, SttState } from '../stt/types'
import { MicButton } from './MicButton'
import { SearchBox } from './SearchBox'

interface TopBarProps {
  compendium: Compendium
  sttState: SttState
  onToggleListening: () => void
  onEndSession: () => void
  provider: SttProviderName
  onSetProvider: (p: SttProviderName) => void
  lastTranscript: string
  onSelect: (entry: CompendiumEntry) => void
}

const STATE_LABEL: Record<SttState, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  listening: 'Listening',
  reconnecting: 'Reconnecting…',
  stopped: 'Stopped',
  error: 'Mic error',
}

const STATE_COLOR: Record<SttState, string> = {
  idle: 'var(--color-ink-dim)',
  connecting: 'var(--color-accent-2)',
  listening: 'var(--color-rule)',
  reconnecting: 'var(--color-accent-2)',
  stopped: 'var(--color-ink-dim)',
  error: 'var(--color-accent)',
}

export function TopBar({
  compendium,
  sttState,
  onToggleListening,
  onEndSession,
  provider,
  onSetProvider,
  lastTranscript,
  onSelect,
}: TopBarProps) {
  return (
    <header
      className="safe-top sticky top-0 z-30 border-b bg-[var(--color-surface)]/95 px-4 pb-3 pt-3 backdrop-blur"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="mb-3 flex items-center gap-3">
        <MicButton state={sttState} onToggle={onToggleListening} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: STATE_COLOR[sttState],
                animation:
                  sttState === 'listening' ? 'pulse 1.6s ease-in-out infinite' : undefined,
              }}
            />
            <span
              className="truncate text-sm font-semibold"
              style={{ color: STATE_COLOR[sttState] }}
            >
              {STATE_LABEL[sttState]}
            </span>
          </div>
          <p className="truncate text-xs text-[var(--color-ink-dim)]" dir="auto">
            {lastTranscript || 'Tap the mic to start listening.'}
          </p>
        </div>

        {/* Dev provider toggle (A/B). Default comes from VITE_STT_PROVIDER. */}
        <ProviderToggle provider={provider} onSetProvider={onSetProvider} />
      </div>

      <SearchBox compendium={compendium} onSelect={onSelect} />

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onEndSession}
          title="End this session and start fresh next time"
          className="rounded-lg border px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] active:bg-[var(--color-surface-2)]"
          style={{ borderColor: 'var(--color-accent)' }}
        >
          End session
        </button>
      </div>

      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </header>
  )
}

function ProviderToggle({
  provider,
  onSetProvider,
}: {
  provider: SttProviderName
  onSetProvider: (p: SttProviderName) => void
}) {
  const next: SttProviderName = provider === 'soniox' ? 'deepgram' : 'soniox'
  return (
    <button
      type="button"
      onClick={() => onSetProvider(next)}
      title="Toggle STT provider (dev A/B)"
      className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-dim)] active:bg-[var(--color-surface-2)]"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {provider}
    </button>
  )
}
