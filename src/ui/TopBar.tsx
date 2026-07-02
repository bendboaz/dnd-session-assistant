// Sticky top bar: listening status + mic toggle, a dev provider toggle for the
// Soniox-vs-Deepgram A/B, and the prominent manual search box beneath them.

import { useEffect, useState } from 'react'
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
  const [confirming, setConfirming] = useState(false)

  // Dismiss the dialog on Escape so keyboard/screen-reader users can back out.
  useEffect(() => {
    if (!confirming) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [confirming])

  return (
    <>
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
            onClick={() => setConfirming(true)}
            title="End this session and start fresh next time"
            className="rounded-lg border border-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] active:bg-[var(--color-surface-2)]"
          >
            End session
          </button>
        </div>

        <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </header>

      {/* Full-screen confirmation overlay — shown only when the user taps "End session". */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-session-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          // Backdrop click dismisses without ending the session.
          onClick={() => setConfirming(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-6 shadow-xl"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
            }}
            // Prevent clicks inside the card from bubbling up to the backdrop.
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="end-session-dialog-title"
              className="mb-2 text-base font-semibold"
              style={{ color: 'var(--color-ink)' }}
            >
              End this session?
            </h2>
            <p className="mb-6 text-sm" style={{ color: 'var(--color-ink-dim)' }}>
              Your transcript and detected entries will be cleared. The mic will stop.
            </p>

            <div className="flex flex-col gap-3">
              {/* Confirm — styled in accent red to signal a destructive action. */}
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  onEndSession()
                }}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold active:opacity-80"
                style={{
                  backgroundColor: 'var(--color-accent)',
                  color: 'var(--color-ink)',
                }}
              >
                End session
              </button>

              {/* Cancel — neutral, non-destructive. */}
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium active:bg-[var(--color-surface-2)]"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-ink-dim)',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
