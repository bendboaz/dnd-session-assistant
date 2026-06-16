// Tests for DEFAULT_KEYTERM_CANDIDATES — the seed list of D&D terms used to
// boost STT recognition. Key invariants verified here:
//
//   1. Most candidates resolve in the SRD (compendium.exact() is non-empty).
//   2. Known non-SRD candidates (Hex, Vampire, Werewolf, Wererat, Succubus)
//      do NOT resolve — so the store's validation step correctly drops them.
//   3. All SRD candidates are genuinely useful: they have a non-trivial name
//      (not empty) and are found in at least one compendium kind.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Compendium } from '../compendium/loader'
import { DEFAULT_KEYTERM_CANDIDATES } from './defaultKeyterms'

// ---------------------------------------------------------------------------
// SRD JSON stub — same pattern as scanner.test.ts and loader.test.ts.
// ---------------------------------------------------------------------------

const SRD_MODULES = import.meta.glob('../../public/data/srd/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const SRD_BY_FILE = new Map<string, unknown>(
  Object.entries(SRD_MODULES).map(([p, data]) => [p.split('/').pop()!, data]),
)

function installSrdFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const file = url.split('/').pop()!
    const data = SRD_BY_FILE.get(file)
    if (data === undefined) {
      return { ok: false, status: 404, json: async () => null } as Response
    }
    return { ok: true, status: 200, json: async () => data } as Response
  }) as typeof fetch
}

// ---------------------------------------------------------------------------
// Known non-SRD terms from REGRESSIONS.md. These are in the candidate list
// for STT boosting but are intentionally absent from the OGL-licensed SRD;
// the runtime store drops them after validation.
// ---------------------------------------------------------------------------

const KNOWN_NON_SRD: ReadonlySet<string> = new Set([
  'Hex',
  'Vampire',
  'Werewolf',
  'Wererat',
  'Succubus',
])

describe('DEFAULT_KEYTERM_CANDIDATES — list shape', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(DEFAULT_KEYTERM_CANDIDATES)).toBe(true)
    expect(DEFAULT_KEYTERM_CANDIDATES.length).toBeGreaterThan(0)
    for (const c of DEFAULT_KEYTERM_CANDIDATES) {
      expect(typeof c).toBe('string')
      expect(c.trim()).toBeTruthy()
    }
  })

  it('has no duplicate entries (case-insensitive)', () => {
    const seen = new Set<string>()
    for (const c of DEFAULT_KEYTERM_CANDIDATES) {
      const key = c.toLowerCase()
      expect(seen.has(key), `Duplicate keyterm: "${c}"`).toBe(false)
      seen.add(key)
    }
  })

  it('contains at least 50 candidates (covers major spells + monsters)', () => {
    expect(DEFAULT_KEYTERM_CANDIDATES.length).toBeGreaterThanOrEqual(50)
  })
})

describe('DEFAULT_KEYTERM_CANDIDATES — SRD presence', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    // Use a fresh import — vi.resetModules() not strictly needed here since
    // this file loads first and the fetch stub is already installed.
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('known non-SRD candidates return empty from compendium.exact()', () => {
    // These entries are present in the candidate list but absent from the OGL SRD.
    // The runtime store's validation step drops them; this test confirms the drop
    // would be correct.
    for (const name of KNOWN_NON_SRD) {
      const hits = compendium.exact(name.toLowerCase())
      expect(hits, `"${name}" should not resolve in the SRD`).toHaveLength(0)
    }
  })

  it('Beholder is not in the SRD (sanity check against a famous non-SRD monster)', () => {
    expect(compendium.exact('beholder')).toHaveLength(0)
  })

  it('the majority of candidates DO resolve in the SRD', () => {
    // We expect all candidates except the KNOWN_NON_SRD set to be in the SRD.
    // If new non-SRD names are added to the list without updating KNOWN_NON_SRD,
    // this test will surface them.
    const notFound: string[] = []
    for (const name of DEFAULT_KEYTERM_CANDIDATES) {
      if (KNOWN_NON_SRD.has(name)) continue
      // The compendium.exact() normalizes input, so pass the raw name.
      const hits = compendium.exact(name)
      if (hits.length === 0) {
        notFound.push(name)
      }
    }
    // If this fails, update KNOWN_NON_SRD or fix the candidate list.
    expect(
      notFound,
      `These candidates are in DEFAULT_KEYTERM_CANDIDATES but NOT in the SRD: ${notFound.join(', ')}`,
    ).toHaveLength(0)
  })

  it('high-priority spells are present in the SRD', () => {
    const highPriority = [
      'Fireball',
      'Magic Missile',
      'Counterspell',
      'Eldritch Blast',
      'Fire Bolt',
      'Cure Wounds',
      'Lightning Bolt',
    ]
    for (const name of highPriority) {
      expect(DEFAULT_KEYTERM_CANDIDATES).toContain(name)
      const hits = compendium.exact(name)
      expect(hits.length, `"${name}" should be in the SRD`).toBeGreaterThan(0)
    }
  })

  it('high-priority monsters are present in the SRD', () => {
    const highPriority = ['Goblin', 'Bugbear', 'Kobold', 'Orc', 'Skeleton', 'Zombie']
    for (const name of highPriority) {
      expect(DEFAULT_KEYTERM_CANDIDATES).toContain(name)
      const hits = compendium.exact(name)
      expect(hits.length, `"${name}" should be in the SRD`).toBeGreaterThan(0)
    }
  })
})
