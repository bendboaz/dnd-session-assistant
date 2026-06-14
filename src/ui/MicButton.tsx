// Big round mic toggle — the primary control. Large tap target (56px) for use
// at arm's length. Color reflects whether we're actively listening.

import type { SttState } from '../stt/types'

interface MicButtonProps {
  state: SttState
  onToggle: () => void
}

export function MicButton({ state, onToggle }: MicButtonProps) {
  const active =
    state === 'listening' || state === 'connecting' || state === 'reconnecting'
  const isError = state === 'error'

  const bg = isError
    ? 'var(--color-accent)'
    : active
      ? 'var(--color-rule)'
      : 'var(--color-surface-2)'

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? 'Stop listening' : 'Start listening'}
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border text-2xl active:scale-95"
      style={{ backgroundColor: bg, borderColor: 'var(--color-border)' }}
    >
      {/* Mic glyph (stop square when active) */}
      {active ? (
        <span
          className="block h-5 w-5 rounded-sm"
          style={{ backgroundColor: 'var(--color-ink)' }}
        />
      ) : (
        <MicGlyph />
      )}
    </button>
  )
}

function MicGlyph() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}
