// Per-kind presentation metadata: label + the theme color variable that drives
// badges, accents and the stat-block header. Colors come from src/index.css
// (--color-spell / -monster / -item / -condition); never hard-code hex here.

import type { EntryKind } from '../compendium/types'

export interface KindMeta {
  label: string
  /** A CSS `var(--color-...)` reference for this kind's accent color. */
  colorVar: string
}

const META: Record<EntryKind, KindMeta> = {
  spell: { label: 'Spell', colorVar: 'var(--color-spell)' },
  monster: { label: 'Monster', colorVar: 'var(--color-monster)' },
  item: { label: 'Item', colorVar: 'var(--color-item)' },
  condition: { label: 'Condition', colorVar: 'var(--color-condition)' },
}

export function kindMeta(kind: EntryKind): KindMeta {
  return META[kind]
}
