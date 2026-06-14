// One detection card in the feed. Tappable (opens the stat block). Shows a
// left color rail in the kind color, the name, kind badge, confidence and the
// matched transcript snippet. `dupCount` collapses consecutive repeats.

import type { FeedItem } from '../state/useAppStore'
import { kindMeta } from './kind'
import { KindBadge } from './KindBadge'

interface DetectionCardProps {
  item: FeedItem
  dupCount: number
  onOpen: () => void
}

export function DetectionCard({ item, dupCount, onOpen }: DetectionCardProps) {
  const { colorVar } = kindMeta(item.entry.kind)
  const confidencePct = Math.round(item.confidence * 100)
  const time = new Date(item.ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-stretch overflow-hidden rounded-xl border bg-[var(--color-surface)] text-left active:bg-[var(--color-surface-2)]"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <span className="w-1.5 shrink-0" style={{ backgroundColor: colorVar }} />
      <span className="min-w-0 flex-1 px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="truncate text-lg font-semibold text-[var(--color-ink)]">
            {item.entry.name}
          </span>
          {dupCount > 1 && (
            <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--color-ink-dim)]">
              ×{dupCount}
            </span>
          )}
        </span>
        <span className="mt-1 flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
          <KindBadge kind={item.entry.kind} />
          <span>{confidencePct}%</span>
          <span aria-hidden>·</span>
          <span>{item.method}</span>
          <span aria-hidden>·</span>
          <span>{time}</span>
        </span>
        {item.matchedText &&
          item.matchedText.toLowerCase() !== item.entry.name.toLowerCase() && (
            <span className="mt-1 block truncate text-xs italic text-[var(--color-ink-dim)]">
              heard “{item.matchedText}”
            </span>
          )}
      </span>
    </button>
  )
}
