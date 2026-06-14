// Newest-first detection feed. Collapses *consecutive* duplicate entries into a
// single card with a ×N counter so a repeated term doesn't flood the list, while
// non-adjacent re-detections still appear as fresh cards.

import { useMemo } from 'react'
import type { CompendiumEntry } from '../compendium/types'
import type { FeedItem } from '../state/useAppStore'
import { DetectionCard } from './DetectionCard'

interface DetectionFeedProps {
  feed: FeedItem[]
  onOpen: (entry: CompendiumEntry) => void
}

interface CollapsedItem {
  item: FeedItem
  count: number
}

function collapseConsecutive(feed: FeedItem[]): CollapsedItem[] {
  const out: CollapsedItem[] = []
  for (const item of feed) {
    const last = out[out.length - 1]
    if (last && last.item.entry.id === item.entry.id) {
      last.count += 1
    } else {
      out.push({ item, count: 1 })
    }
  }
  return out
}

export function DetectionFeed({ feed, onOpen }: DetectionFeedProps) {
  const collapsed = useMemo(() => collapseConsecutive(feed), [feed])

  if (collapsed.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-[var(--color-ink-dim)]">
        <p className="text-sm">
          No detections yet. Start listening, or search above.
        </p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2 px-3 py-3">
      {collapsed.map(({ item, count }) => (
        <li key={item.feedId}>
          <DetectionCard
            item={item}
            dupCount={count}
            onOpen={() => onOpen(item.entry)}
          />
        </li>
      ))}
    </ul>
  )
}
