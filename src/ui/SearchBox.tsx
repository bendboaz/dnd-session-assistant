// Manual search fallback. Queries `compendium.search` live as the user types and
// renders a tappable result list. Prominent and large-tap-target by design — at
// the table this is the quick "just look it up" path when auto-detect misses.

import { useMemo, useState } from 'react'
import type { Compendium } from '../compendium/loader'
import type { CompendiumEntry } from '../compendium/types'
import { KindBadge } from './KindBadge'

interface SearchBoxProps {
  compendium: Compendium
  onSelect: (entry: CompendiumEntry) => void
}

export function SearchBox({ compendium, onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = query.trim()
    if (q.length < 2) return []
    return compendium.search(q, 8)
  }, [query, compendium])

  const pick = (entry: CompendiumEntry) => {
    onSelect(entry)
    setQuery('')
  }

  return (
    <div className="relative">
      <input
        type="search"
        inputMode="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search spells, monsters, items…"
        aria-label="Search the compendium"
        className="w-full rounded-xl border bg-[var(--color-surface-2)] px-4 py-3 text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-dim)] outline-none focus:border-[var(--color-accent-2)]"
        style={{ borderColor: 'var(--color-border)' }}
      />

      {results.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border bg-[var(--color-surface)] shadow-2xl"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {results.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => pick(entry)}
                className="flex w-full items-center justify-between gap-3 border-b px-4 py-3 text-left last:border-b-0 active:bg-[var(--color-surface-2)]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <span className="truncate text-base font-medium text-[var(--color-ink)]">
                  {entry.name}
                </span>
                <KindBadge kind={entry.kind} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
