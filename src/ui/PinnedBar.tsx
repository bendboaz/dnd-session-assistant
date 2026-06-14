// Horizontal quick-access strip of pinned entries. Pinned names also feed the
// STT provider's keyterms (handled in the store). Tapping a chip reopens its
// stat block; the × removes the pin.

import type { CompendiumEntry } from '../compendium/types'
import { kindMeta } from './kind'

interface PinnedBarProps {
  pinned: CompendiumEntry[]
  onOpen: (entry: CompendiumEntry) => void
  onUnpin: (entry: CompendiumEntry) => void
}

export function PinnedBar({ pinned, onOpen, onUnpin }: PinnedBarProps) {
  if (pinned.length === 0) return null

  return (
    <div
      className="border-b bg-[var(--color-surface)] px-3 py-2"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {pinned.map((entry) => {
          const { colorVar } = kindMeta(entry.kind)
          return (
            <div
              key={entry.id}
              className="flex shrink-0 items-center gap-1 rounded-full border py-1 pl-3 pr-1"
              style={{
                borderColor: colorVar,
                backgroundColor: `color-mix(in srgb, ${colorVar} 12%, transparent)`,
              }}
            >
              <button
                type="button"
                onClick={() => onOpen(entry)}
                className="max-w-[40vw] truncate text-sm font-medium text-[var(--color-ink)]"
              >
                {entry.name}
              </button>
              <button
                type="button"
                onClick={() => onUnpin(entry)}
                aria-label={`Unpin ${entry.name}`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-[var(--color-ink-dim)] active:bg-[var(--color-surface-2)]"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
