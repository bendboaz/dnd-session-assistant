// Loads the vendored SRD JSON, normalizes it into source-agnostic
// `CompendiumEntry` records, and builds the indexes the rest of the app uses:
//   - nameIndex:     exact normalized name/alias -> entries  (fast auto-detect)
//   - phoneticIndex: double-metaphone key -> entries         (homophone fallback)
//   - fuse:          fuzzy search                            (manual search + STT slop)

import Fuse from 'fuse.js'
import { normalize, phoneticKey } from '../lib/text'
import type {
  CompendiumEntry,
  ConditionData,
  ItemData,
  MonsterData,
  SpellData,
} from './types'

const SRD_BASE = `${import.meta.env.BASE_URL}data/srd/`

// ---- Minimal raw SRD shapes (only the fields we read) ----

interface Ref {
  name: string
}
interface RawSpell {
  index: string
  name: string
  desc: string[]
  higher_level?: string[]
  range: string
  components: string[]
  material?: string
  ritual: boolean
  duration: string
  concentration: boolean
  casting_time: string
  level: number
  school: Ref
  classes: Ref[]
}
interface RawMonster {
  index: string
  name: string
  size: string
  type: string
  alignment: string
  armor_class: { value: number; type?: string; armor?: Ref[] }[]
  hit_points: number
  hit_dice: string
  speed: Record<string, string | boolean>
  strength: number
  dexterity: number
  constitution: number
  intelligence: number
  wisdom: number
  charisma: number
  senses?: Record<string, string | number>
  languages?: string
  challenge_rating: number
  xp?: number
  condition_immunities?: Ref[]
  damage_immunities?: string[]
  damage_resistances?: string[]
  damage_vulnerabilities?: string[]
  special_abilities?: { name: string; desc: string }[]
  actions?: { name: string; desc: string }[]
  legendary_actions?: { name: string; desc: string }[]
}
interface RawItem {
  index: string
  name: string
  equipment_category: Ref
  rarity?: { name: string }
  desc?: string[]
}
interface RawEquipment {
  index: string
  name: string
  equipment_category: Ref
  desc?: string[]
}
interface RawCondition {
  index: string
  name: string
  desc: string[]
}

// ---- Normalizers: raw -> CompendiumEntry ----

function makeAliases(name: string): string[] {
  const set = new Set<string>()
  const base = normalize(name)
  set.add(base)
  // A bare-apostrophe variant helps when STT drops the possessive entirely.
  set.add(normalize(name.replace(/['’]/g, '')))
  // Run-together variant: STT often drops the space in multi-word names
  // ("Fire Bolt" -> "firebolt", "Magic Missile" -> "magicmissile"), which would
  // otherwise miss (a single token can't match a multi-word entry, and the
  // scanner's single-token guard blocks fuzzy/phonetic). Index the no-space form
  // so it still resolves at the exact tier.
  const noSpace = base.replace(/ /g, '')
  if (noSpace !== base) set.add(noSpace)
  return [...set].filter(Boolean)
}

function spellEntry(r: RawSpell): CompendiumEntry {
  const data: SpellData = {
    level: r.level,
    school: r.school?.name ?? '',
    castingTime: r.casting_time,
    range: r.range,
    components: r.components ?? [],
    material: r.material,
    duration: r.duration,
    concentration: r.concentration,
    ritual: r.ritual,
    classes: (r.classes ?? []).map((c) => c.name),
    desc: r.desc ?? [],
    higherLevel: r.higher_level ?? [],
  }
  return {
    id: `srd:spell:${r.index}`,
    name: r.name,
    aliases: makeAliases(r.name),
    kind: 'spell',
    source: 'SRD',
    data,
  }
}

const CR_FRACTIONS: Record<string, string> = {
  '0.125': '1/8',
  '0.25': '1/4',
  '0.5': '1/2',
}
function formatCR(cr: number): string {
  return CR_FRACTIONS[String(cr)] ?? String(cr)
}

function formatArmorClass(acs: RawMonster['armor_class']): string {
  if (!acs?.length) return '—'
  const ac = acs[0]
  const extras = (ac.armor ?? []).map((a) => a.name.toLowerCase())
  return extras.length ? `${ac.value} (${extras.join(', ')})` : String(ac.value)
}

function formatSpeed(speed: RawMonster['speed']): string {
  return Object.entries(speed ?? {})
    .map(([k, v]) => (v === true ? k : `${k} ${v}`))
    .join(', ')
}

function formatSenses(senses?: Record<string, string | number>): string {
  if (!senses) return ''
  return Object.entries(senses)
    .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
    .join(', ')
}

function monsterEntry(r: RawMonster): CompendiumEntry {
  const data: MonsterData = {
    size: r.size,
    type: r.type,
    alignment: r.alignment,
    armorClass: formatArmorClass(r.armor_class),
    hitPoints: r.hit_points,
    hitDice: r.hit_dice,
    speed: formatSpeed(r.speed),
    abilities: {
      str: r.strength,
      dex: r.dexterity,
      con: r.constitution,
      int: r.intelligence,
      wis: r.wisdom,
      cha: r.charisma,
    },
    senses: formatSenses(r.senses),
    languages: r.languages ?? '',
    challengeRating: formatCR(r.challenge_rating),
    xp: r.xp ?? 0,
    conditionImmunities: (r.condition_immunities ?? []).map((c) => c.name),
    damageImmunities: r.damage_immunities ?? [],
    damageResistances: r.damage_resistances ?? [],
    damageVulnerabilities: r.damage_vulnerabilities ?? [],
    specialAbilities: r.special_abilities ?? [],
    actions: r.actions ?? [],
    legendaryActions: r.legendary_actions ?? [],
  }
  return {
    id: `srd:monster:${r.index}`,
    name: r.name,
    aliases: makeAliases(r.name),
    kind: 'monster',
    source: 'SRD',
    data,
  }
}

function itemEntry(r: RawItem): CompendiumEntry {
  const data: ItemData = {
    category: r.equipment_category?.name ?? '',
    rarity: r.rarity?.name,
    desc: r.desc ?? [],
  }
  return {
    id: `srd:item:${r.index}`,
    name: r.name,
    aliases: makeAliases(r.name),
    kind: 'item',
    source: 'SRD',
    data,
  }
}

function equipmentEntry(r: RawEquipment): CompendiumEntry {
  const data: ItemData = {
    category: r.equipment_category?.name ?? '',
    desc: r.desc ?? [],
  }
  return {
    id: `srd:item:${r.index}`,
    name: r.name,
    aliases: makeAliases(r.name),
    kind: 'item',
    source: 'SRD',
    data,
  }
}

function conditionEntry(r: RawCondition): CompendiumEntry {
  const data: ConditionData = { desc: r.desc ?? [] }
  return {
    id: `srd:condition:${r.index}`,
    name: r.name,
    aliases: makeAliases(r.name),
    kind: 'condition',
    source: 'SRD',
    data,
  }
}

// ---- Compendium: entries + indexes + query helpers ----

export interface Compendium {
  entries: CompendiumEntry[]
  /** All distinct display names (for STT keyterm seeding & debugging). */
  names: string[]
  /** Exact normalized name/alias -> entries. */
  exact(normalizedPhrase: string): CompendiumEntry[]
  /** Phonetic (double-metaphone) lookup for a phrase. */
  phonetic(phrase: string): CompendiumEntry[]
  /** Fuzzy search, best matches first. */
  search(query: string, limit?: number): CompendiumEntry[]
  /** Longest alias word-count, so the scanner knows the widest n-gram to try. */
  maxAliasWords: number
}

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${SRD_BASE}${file}`)
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`)
  return res.json() as Promise<T>
}

function buildCompendium(entries: CompendiumEntry[]): Compendium {
  const exactIndex = new Map<string, CompendiumEntry[]>()
  const phoneticIndex = new Map<string, CompendiumEntry[]>()
  let maxAliasWords = 1

  const push = (map: Map<string, CompendiumEntry[]>, key: string, e: CompendiumEntry) => {
    if (!key) return
    const list = map.get(key)
    if (list) {
      if (!list.includes(e)) list.push(e)
    } else {
      map.set(key, [e])
    }
  }

  for (const e of entries) {
    for (const alias of e.aliases) {
      push(exactIndex, alias, e)
      push(phoneticIndex, phoneticKey(alias), e)
      const words = alias.split(' ').length
      if (words > maxAliasWords) maxAliasWords = words
    }
  }

  const fuse = new Fuse(entries, {
    keys: ['name', 'aliases'],
    threshold: 0.34, // moderately strict; STT slop handled by phonetic index
    ignoreLocation: true,
    includeScore: true,
  })

  return {
    entries,
    names: entries.map((e) => e.name),
    maxAliasWords,
    exact: (phrase) => exactIndex.get(normalize(phrase)) ?? [],
    phonetic: (phrase) => phoneticIndex.get(phoneticKey(phrase)) ?? [],
    search: (query, limit = 12) =>
      fuse
        .search(query, { limit })
        .map((r) => r.item),
  }
}

let cached: Promise<Compendium> | null = null

/** Loads + indexes the SRD compendium once, then returns the cached instance. */
export function loadCompendium(): Promise<Compendium> {
  if (cached) return cached
  cached = (async () => {
    const [spells, monsters, items, equipment, conditions] = await Promise.all([
      fetchJson<RawSpell[]>('5e-SRD-Spells.json'),
      fetchJson<RawMonster[]>('5e-SRD-Monsters.json'),
      fetchJson<RawItem[]>('5e-SRD-Magic-Items.json'),
      fetchJson<RawEquipment[]>('5e-SRD-Equipment.json'),
      fetchJson<RawCondition[]>('5e-SRD-Conditions.json'),
    ])
    const entries: CompendiumEntry[] = [
      ...spells.map(spellEntry),
      ...monsters.map(monsterEntry),
      ...items.map(itemEntry),
      ...equipment.map(equipmentEntry),
      ...conditions.map(conditionEntry),
    ]
    return buildCompendium(entries)
  })()
  return cached
}
