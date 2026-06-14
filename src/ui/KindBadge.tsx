// Small per-kind colored badge. Color is driven by the theme variable for the
// kind (see src/ui/kind.ts) — tinted background + solid border in that color.

import type { EntryKind } from '../compendium/types'
import { kindMeta } from './kind'

export function KindBadge({ kind }: { kind: EntryKind }) {
  const { label, colorVar } = kindMeta(kind)
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{
        color: colorVar,
        borderColor: colorVar,
        // 22 = ~13% alpha tint behind the label.
        backgroundColor: `color-mix(in srgb, ${colorVar} 16%, transparent)`,
      }}
    >
      {label}
    </span>
  )
}
