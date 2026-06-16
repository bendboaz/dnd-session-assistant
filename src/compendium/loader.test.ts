// Integration tests for the compendium loader against the real vendored SRD.
//
// These tests verify that loadCompendium() correctly normalizes raw SRD JSON,
// builds its indexes, and exposes the right query behaviour. fetch is stubbed
// via import.meta.glob (Vite-aware, no @types/node needed) exactly as in
// scanner.test.ts, then the module cache is reset so each describe gets a
// fresh compendium instance.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Compendium } from './loader'
import { installSrdFetch } from '../test/srdFetch'

// ---------------------------------------------------------------------------
// Helper that wipes the module cache so loadCompendium()'s module-level
// `cached` variable resets between describe blocks.
// ---------------------------------------------------------------------------

async function freshCompendium(): Promise<Compendium> {
  vi.resetModules()
  const { loadCompendium } = await import('./loader')
  return loadCompendium()
}

// ---------------------------------------------------------------------------
// Structural / count sanity checks
// ---------------------------------------------------------------------------

describe('loadCompendium — structure & counts', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    compendium = await freshCompendium()
  })

  it('loads a non-empty entry list', () => {
    expect(compendium.entries.length).toBeGreaterThan(0)
  })

  it('has entries from all five SRD file types', () => {
    const kinds = new Set(compendium.entries.map((e) => e.kind))
    // spells, monsters, conditions come from dedicated files; items cover both
    // magic items and equipment.
    expect(kinds).toContain('spell')
    expect(kinds).toContain('monster')
    expect(kinds).toContain('item')
    expect(kinds).toContain('condition')
  })

  // Count baselines below are tied to the vendored SRD dataset (public/data/srd/).
  // If the SRD JSON files are re-vendored, re-check these numbers and update accordingly.

  it('has at least 319 spells (SRD spell count)', () => {
    const spells = compendium.entries.filter((e) => e.kind === 'spell')
    expect(spells.length).toBeGreaterThanOrEqual(319)
  })

  it('has at least 334 monsters', () => {
    const monsters = compendium.entries.filter((e) => e.kind === 'monster')
    expect(monsters.length).toBeGreaterThanOrEqual(334)
  })

  it('has at least 15 conditions', () => {
    // 15 conditions in the vendored SRD dataset; >= so a future re-vendor adding
    // conditions doesn't break this assertion.
    const conditions = compendium.entries.filter((e) => e.kind === 'condition')
    expect(conditions.length).toBeGreaterThanOrEqual(15)
  })

  it('names array length matches entries array length', () => {
    expect(compendium.names.length).toBe(compendium.entries.length)
  })

  it('maxAliasWords is at least 3 (multi-word SRD names exist)', () => {
    // e.g. "Wall of Fire" = 3 words; "Power Word Kill" = 3; "Spirit Guardians" = 2.
    expect(compendium.maxAliasWords).toBeGreaterThanOrEqual(3)
  })

  it('all entries have non-empty id, name, aliases, kind, source, data', () => {
    for (const e of compendium.entries) {
      expect(e.id).toBeTruthy()
      expect(e.name).toBeTruthy()
      expect(e.aliases.length).toBeGreaterThan(0)
      expect(e.kind).toBeTruthy()
      expect(e.source).toBe('SRD')
      expect(e.data).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// exact() index
// ---------------------------------------------------------------------------

describe('loadCompendium — exact() index', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    compendium = await freshCompendium()
  })

  it('exact("fireball") returns the Fireball spell', () => {
    const hits = compendium.exact('fireball')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((e) => e.name === 'Fireball')).toBe(true)
  })

  it('exact("fire bolt") returns the Fire Bolt spell', () => {
    const hits = compendium.exact('fire bolt')
    expect(hits.some((e) => e.name === 'Fire Bolt')).toBe(true)
  })

  it('exact("firebolt") — no-space alias — returns Fire Bolt', () => {
    // makeAliases builds a no-space alias so run-together STT output still resolves.
    const hits = compendium.exact('firebolt')
    expect(hits.some((e) => e.name === 'Fire Bolt')).toBe(true)
  })

  it('exact("magicmissile") — no-space alias — returns Magic Missile', () => {
    const hits = compendium.exact('magicmissile')
    expect(hits.some((e) => e.name === 'Magic Missile')).toBe(true)
  })

  it('exact() accepts mixed-case input (normalizes internally)', () => {
    const hits = compendium.exact('FIREBALL')
    expect(hits.some((e) => e.name === 'Fireball')).toBe(true)
  })

  it('exact("goblin") returns the Goblin monster', () => {
    const hits = compendium.exact('goblin')
    const goblin = hits.find((e) => e.name === 'Goblin')
    expect(goblin).toBeDefined()
    expect(goblin!.kind).toBe('monster')
  })

  it('exact("blinded") returns the Blinded condition', () => {
    const hits = compendium.exact('blinded')
    expect(hits.some((e) => e.name === 'Blinded' && e.kind === 'condition')).toBe(true)
  })

  // Non-SRD names: the task brief explicitly states these are absent.
  it('exact("beholder") returns empty (Beholder is not in the SRD)', () => {
    expect(compendium.exact('beholder')).toHaveLength(0)
  })

  it('exact("hex") returns empty (Hex is not in the SRD)', () => {
    expect(compendium.exact('hex')).toHaveLength(0)
  })

  it('exact("vampire") returns empty (Vampire is not in the SRD)', () => {
    expect(compendium.exact('vampire')).toHaveLength(0)
  })

  it('exact("") returns empty', () => {
    expect(compendium.exact('')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// phonetic() index
// ---------------------------------------------------------------------------

describe('loadCompendium — phonetic() index', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    compendium = await freshCompendium()
  })

  it('phonetic("fireball") returns Fireball', () => {
    const hits = compendium.phonetic('fireball')
    expect(hits.some((e) => e.name === 'Fireball')).toBe(true)
  })

  it('phonetic("fire ball") returns nothing — spaced phrase key differs from single-word key', () => {
    // phoneticKey("fire ball") = "FR PL"; Fireball is indexed under "FRPL".
    // The scanner handles this by also trying phonetic(window.join('')), but the
    // compendium's own phonetic() method just does one lookup.
    const spaced = compendium.phonetic('fire ball')
    // We verify the index key is different: the spaced form should NOT find Fireball.
    // (The scanner's two-probe logic covers the join case — this documents that
    // the raw phonetic() method alone doesn't bridge the gap.)
    expect(spaced.some((e) => e.name === 'Fireball')).toBe(false)
  })

  it('phonetic("magic missael") returns Magic Missile (same metaphone code)', () => {
    // missael and missile both code to MSL under double-metaphone.
    const hits = compendium.phonetic('magic missael')
    expect(hits.some((e) => e.name === 'Magic Missile')).toBe(true)
  })

  it('phonetic("magic missal") returns Magic Missile', () => {
    const hits = compendium.phonetic('magic missal')
    expect(hits.some((e) => e.name === 'Magic Missile')).toBe(true)
  })

  it('phonetic("bee holder") returns nothing (two-word probe needed for beholder)', () => {
    // Beholder is not in the SRD; this also verifies no phantom match.
    const hits = compendium.phonetic('bee holder')
    expect(hits.some((e) => e.name === 'Beholder')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// search() (fuzzy)
// ---------------------------------------------------------------------------

describe('loadCompendium — search() fuzzy', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    compendium = await freshCompendium()
  })

  it('search("fireball") returns Fireball as the top hit', () => {
    const results = compendium.search('fireball')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].name).toBe('Fireball')
  })

  it('search("shield") returns Shield even though it is stop-listed for auto-emit', () => {
    // The stop-list only blocks the scanner's auto-emit path; manual search is unaffected.
    const results = compendium.search('shield')
    expect(results.some((e) => e.name.toLowerCase() === 'shield')).toBe(true)
  })

  it('search("fly") returns Fly spell', () => {
    const results = compendium.search('fly')
    expect(results.some((e) => e.name === 'Fly' && e.kind === 'spell')).toBe(true)
  })

  it('search returns at most the requested limit', () => {
    const results = compendium.search('fire', 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('search("beholder") returns no Beholder (not in SRD)', () => {
    const results = compendium.search('beholder')
    expect(results.some((e) => e.name === 'Beholder')).toBe(false)
  })

  it('search("vampire") returns no Vampire (not in SRD)', () => {
    const results = compendium.search('vampire')
    expect(results.some((e) => e.name === 'Vampire')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CompendiumEntry data shape checks (spot-check a few key entries)
// ---------------------------------------------------------------------------

describe('loadCompendium — entry data payloads', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    compendium = await freshCompendium()
  })

  it('Fireball spell entry has correct SpellData fields', () => {
    const fb = compendium.exact('fireball').find((e) => e.name === 'Fireball')!
    expect(fb).toBeDefined()
    const data = fb.data as { level: number; school: string; desc: string[] }
    expect(data.level).toBe(3)
    expect(data.school).toBeTruthy()
    expect(data.desc.length).toBeGreaterThan(0)
  })

  it('Goblin monster entry has correct MonsterData fields', () => {
    const goblin = compendium.exact('goblin').find((e) => e.name === 'Goblin')!
    expect(goblin).toBeDefined()
    const data = goblin.data as {
      hitPoints: number
      challengeRating: string
      abilities: { str: number }
    }
    expect(data.hitPoints).toBeGreaterThan(0)
    expect(data.challengeRating).toBe('1/4')
    expect(typeof data.abilities.str).toBe('number')
  })

  it('Blinded condition entry has non-empty desc', () => {
    const blinded = compendium.exact('blinded').find((e) => e.name === 'Blinded')!
    expect(blinded).toBeDefined()
    const data = blinded.data as { desc: string[] }
    expect(data.desc.length).toBeGreaterThan(0)
  })

  it('entry IDs follow the "srd:<kind>:<index>" pattern', () => {
    const fb = compendium.exact('fireball').find((e) => e.name === 'Fireball')!
    expect(fb.id).toMatch(/^srd:spell:/)
    const goblin = compendium.exact('goblin').find((e) => e.name === 'Goblin')!
    expect(goblin.id).toMatch(/^srd:monster:/)
  })
})

// ---------------------------------------------------------------------------
// Caching: loadCompendium() must return the same instance on repeated calls.
// ---------------------------------------------------------------------------

describe('loadCompendium — module cache', () => {
  it('returns the same Promise on repeated calls without module reset', async () => {
    installSrdFetch()
    vi.resetModules()
    const { loadCompendium } = await import('./loader')
    const p1 = loadCompendium()
    const p2 = loadCompendium()
    // Both calls return the same Promise object (module-level cache).
    expect(p1).toBe(p2)
    await p1 // ensure it resolves cleanly
  })
})
