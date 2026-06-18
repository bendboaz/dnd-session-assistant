import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readPinnedIds, writePinnedIds, PINNED_IDS_KEY, resolvePinnedEntries } from './useAppStore'
import type { CompendiumEntry } from '../compendium/types'

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage stub
// ---------------------------------------------------------------------------

function makeLocalStorageStub() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
    _store: store,
  }
}

// Minimal CompendiumEntry fixtures (only the fields used by resolvePinnedEntries)
const ENTRY_A: CompendiumEntry = {
  id: 'srd:spell:fireball',
  name: 'Fireball',
  aliases: ['fireball'],
  kind: 'spell',
  source: 'srd',
  data: { level: 3, school: 'Evocation', castingTime: '1 action', range: '150 feet',
          components: ['V', 'S', 'M'], duration: 'Instantaneous', concentration: false,
          ritual: false, classes: ['Wizard'], desc: [], higherLevel: [] },
}

const ENTRY_B: CompendiumEntry = {
  id: 'srd:monster:goblin',
  name: 'Goblin',
  aliases: ['goblin'],
  kind: 'monster',
  source: 'srd',
  data: { size: 'Small', type: 'humanoid', alignment: 'neutral evil', armorClass: '15',
          hitPoints: 7, hitDice: '2d6', speed: 'walk 30 ft.',
          abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
          senses: 'darkvision 60 ft.', languages: 'Common, Goblin', challengeRating: '1/4',
          xp: 50, conditionImmunities: [], damageImmunities: [], damageResistances: [],
          damageVulnerabilities: [], specialAbilities: [], actions: [], legendaryActions: [] },
}

const ALL_ENTRIES: CompendiumEntry[] = [ENTRY_A, ENTRY_B]

// ---------------------------------------------------------------------------
// readPinnedIds
// ---------------------------------------------------------------------------

describe('readPinnedIds', () => {
  let stub: ReturnType<typeof makeLocalStorageStub>

  beforeEach(() => {
    stub = makeLocalStorageStub()
    vi.stubGlobal('localStorage', stub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns [] when the key is absent', () => {
    expect(readPinnedIds()).toEqual([])
  })

  it('round-trips an array written by writePinnedIds', () => {
    writePinnedIds(['srd:spell:fireball', 'srd:monster:goblin'])
    expect(readPinnedIds()).toEqual(['srd:spell:fireball', 'srd:monster:goblin'])
  })

  it('returns [] on malformed JSON', () => {
    stub.setItem(PINNED_IDS_KEY, '{ not valid json ]]')
    expect(readPinnedIds()).toEqual([])
  })

  it('returns [] when stored value is valid JSON but not an array', () => {
    stub.setItem(PINNED_IDS_KEY, JSON.stringify({ id: 'srd:spell:fireball' }))
    expect(readPinnedIds()).toEqual([])
  })

  it('filters out non-string elements from a mixed array', () => {
    stub.setItem(PINNED_IDS_KEY, JSON.stringify(['srd:spell:fireball', 42, null, true, 'srd:monster:goblin']))
    expect(readPinnedIds()).toEqual(['srd:spell:fireball', 'srd:monster:goblin'])
  })
})

// ---------------------------------------------------------------------------
// writePinnedIds
// ---------------------------------------------------------------------------

describe('writePinnedIds', () => {
  let stub: ReturnType<typeof makeLocalStorageStub>

  beforeEach(() => {
    stub = makeLocalStorageStub()
    vi.stubGlobal('localStorage', stub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes JSON that readPinnedIds reads back correctly', () => {
    const ids = ['srd:spell:fireball', 'srd:monster:goblin']
    writePinnedIds(ids)
    expect(readPinnedIds()).toEqual(ids)
  })

  it('swallows errors when setItem throws (e.g. quota exceeded / private mode)', () => {
    const throwingStub = {
      ...stub,
      setItem: (_key: string, _value: string): void => {
        throw new DOMException('QuotaExceededError')
      },
    }
    vi.stubGlobal('localStorage', throwingStub)
    // Must not throw
    expect(() => writePinnedIds(['srd:spell:fireball'])).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// resolvePinnedEntries
// ---------------------------------------------------------------------------

describe('resolvePinnedEntries', () => {
  it('resolves known IDs to entries in order', () => {
    const result = resolvePinnedEntries(ALL_ENTRIES, ['srd:spell:fireball', 'srd:monster:goblin'])
    expect(result).toEqual([ENTRY_A, ENTRY_B])
  })

  it('resolves in reverse order when IDs are reversed', () => {
    const result = resolvePinnedEntries(ALL_ENTRIES, ['srd:monster:goblin', 'srd:spell:fireball'])
    expect(result).toEqual([ENTRY_B, ENTRY_A])
  })

  it('silently drops stale IDs that are not in the entries array', () => {
    const result = resolvePinnedEntries(ALL_ENTRIES, ['srd:spell:fireball', 'srd:spell:stale-id'])
    expect(result).toEqual([ENTRY_A])
  })

  it('returns [] for an empty ids array', () => {
    expect(resolvePinnedEntries(ALL_ENTRIES, [])).toEqual([])
  })

  it('returns [] when entries is empty', () => {
    expect(resolvePinnedEntries([], ['srd:spell:fireball'])).toEqual([])
  })
})
