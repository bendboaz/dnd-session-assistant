// Generic, source-agnostic compendium model.
//
// Everything the app consumes (matching, search, stat blocks) goes through
// `CompendiumEntry`. The raw SRD JSON shapes are normalized into this on load.
// Adding non-SRD content later means producing more `CompendiumEntry` values with
// a different `source` — no changes to matching or UI required.

export type EntryKind = 'spell' | 'monster' | 'item' | 'condition'

export interface CompendiumEntry {
  /** Stable id, unique across sources: e.g. "srd:spell:fireball". */
  id: string
  /** Display name, e.g. "Fireball". */
  name: string
  /** Lower-cased, punctuation-stripped alternatives used for matching/search. */
  aliases: string[]
  kind: EntryKind
  /** Where this entry came from. SRD today; owned books later. */
  source: string
  /** The original normalized payload, rendered by the per-kind stat block. */
  data: SpellData | MonsterData | ItemData | ConditionData
}

// ---- Per-kind normalized payloads (subset of SRD fields the UI renders) ----

export interface NamedRef {
  name: string
}

export interface SpellData {
  level: number // 0 = cantrip
  school: string
  castingTime: string
  range: string
  components: string[]
  material?: string
  duration: string
  concentration: boolean
  ritual: boolean
  classes: string[]
  desc: string[]
  higherLevel: string[]
}

export interface MonsterAction {
  name: string
  desc: string
}

export interface MonsterData {
  size: string
  type: string
  alignment: string
  armorClass: string // flattened, e.g. "15 (leather armor, shield)"
  hitPoints: number
  hitDice: string // e.g. "2d6"
  speed: string // flattened, e.g. "walk 30 ft."
  abilities: {
    str: number
    dex: number
    con: number
    int: number
    wis: number
    cha: number
  }
  senses: string
  languages: string
  challengeRating: string // e.g. "1/4"
  xp: number
  conditionImmunities: string[]
  damageImmunities: string[]
  damageResistances: string[]
  damageVulnerabilities: string[]
  specialAbilities: MonsterAction[]
  actions: MonsterAction[]
  legendaryActions: MonsterAction[]
}

export interface ItemData {
  category: string
  rarity?: string
  desc: string[]
}

export interface ConditionData {
  desc: string[]
}
