// Bottom-sheet overlay hosting a stat block. Slides up over the feed (not a
// full-screen takeover) so dismissing returns straight to the table view.
// Header carries the name, kind badge and the pin toggle.

import { useEffect } from 'react'
import type { CompendiumEntry } from '../compendium/types'
import { kindMeta } from './kind'
import { KindBadge } from './KindBadge'
import { StatBlock } from './StatBlock'

interface EntryDetailProps {
  entry: CompendiumEntry
  pinned: boolean
  onTogglePin: () => void
  onClose: () => void
}

export function EntryDetail({ entry, pinned, onTogglePin, onClose }: EntryDetailProps) {
  // Close on Escape (laptop) for convenience.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="safe-bottom flex max-h-[88vh] flex-col rounded-t-2xl border-t bg-[var(--color-surface)]"
        style={{ borderColor: kindMeta(entry.kind).colorVar }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2">
          <span className="h-1 w-10 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* Header */}
        <div
          className="flex items-start gap-3 border-b px-4 py-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-bold text-[var(--color-ink)]">
              {entry.name}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <KindBadge kind={entry.kind} />
              <span className="text-xs text-[var(--color-ink-dim)]">{entry.source}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={pinned}
            aria-label={pinned ? 'Unpin' : 'Pin'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border active:scale-95"
            style={{
              borderColor: pinned ? 'var(--color-accent-2)' : 'var(--color-border)',
              color: pinned ? 'var(--color-accent-2)' : 'var(--color-ink-dim)',
              backgroundColor: pinned
                ? 'color-mix(in srgb, var(--color-accent-2) 16%, transparent)'
                : 'transparent',
            }}
          >
            <PinGlyph filled={pinned} />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[var(--color-ink-dim)] active:scale-95"
            style={{ borderColor: 'var(--color-border)' }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-4 py-4">
          <StatBlock entry={entry} />
        </div>
      </div>
    </div>
  )
}

function PinGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z" />
      <line x1="12" y1="15" x2="12" y2="21" />
    </svg>
  )
}
