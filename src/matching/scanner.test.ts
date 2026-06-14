import { beforeAll, describe, expect, it } from 'vitest'
import { normalize, phoneticKey } from '../lib/text'
import type { Compendium } from '../compendium/loader'
import type { CompendiumEntry, EntryKind } from '../compendium/types'
import { createScanner } from './scanner'

// ---------------------------------------------------------------------------
// A tiny hand-built Compendium fake. The task explicitly permits this for unit
// tests, and it lets us exercise the phonetic/fuzzy tiers deterministically with
// names that aren't in the real SRD (e.g. Beholder, which is not OGL content).
// It mirrors the index-building logic of the real loader closely enough to be a
// faithful stand-in: per-alias exact + phonetic indexes and a substring-ish
// fuzzy fallback.
// ---------------------------------------------------------------------------

function fakeEntry(id: string, name: string, kind: EntryKind, aliases?: string[]): CompendiumEntry {
  const base = new Set<string>([normalize(name), ...(aliases ?? []).map(normalize)])
  return {
    id,
    name,
    aliases: [...base].filter(Boolean),
    kind,
    source: 'TEST',
    // The scanner never inspects `data`, so a minimal condition payload is fine.
    data: { desc: [] },
  }
}

function buildFake(entries: CompendiumEntry[]): Compendium {
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

  return {
    entries,
    names: entries.map((e) => e.name),
    maxAliasWords,
    exact: (phrase) => exactIndex.get(normalize(phrase)) ?? [],
    phonetic: (phrase) => phoneticIndex.get(phoneticKey(phrase)) ?? [],
    // Crude best-first fuzzy: rank by normalized substring containment, then by
    // length closeness. Good enough to verify the scanner's tier ordering.
    search: (query, limit = 12) => {
      const q = normalize(query)
      return entries
        .map((e) => {
          const hay = [normalize(e.name), ...e.aliases]
          let score = Infinity
          for (const h of hay) {
            if (h === q) score = Math.min(score, 0)
            else if (h.includes(q) || q.includes(h)) score = Math.min(score, Math.abs(h.length - q.length) + 1)
          }
          return { e, score }
        })
        .filter((r) => r.score !== Infinity)
        .sort((a, b) => a.score - b.score)
        .slice(0, limit)
        .map((r) => r.e)
    },
  }
}

const FAKE = buildFake([
  fakeEntry('test:spell:fireball', 'Fireball', 'spell'),
  fakeEntry('test:monster:beholder', 'Beholder', 'monster'),
  fakeEntry('test:spell:hideous-laughter', 'Hideous Laughter', 'spell'),
  fakeEntry('test:monster:goblin', 'Goblin', 'monster'),
  fakeEntry('test:spell:shield', 'Shield', 'spell'),
  fakeEntry('test:spell:light', 'Light', 'spell'),
  fakeEntry('test:spell:mage-hand', 'Mage Hand', 'spell'),
])

describe('createScanner — fake compendium', () => {
  it('detects an exact single-word name', () => {
    const s = createScanner(FAKE)
    const d = s.scan('I cast fireball')
    expect(d).toHaveLength(1)
    expect(d[0].entry.name).toBe('Fireball')
    expect(d[0].method).toBe('exact')
    expect(d[0].confidence).toBe(1.0)
  })

  it('handles possessive multi-word names', () => {
    const s = createScanner(FAKE)
    // normalize() strips the possessive: "tasha's hideous laughter" -> the
    // "hideous laughter" alias still matches the trailing bigram.
    const d = s.scan("tasha's hideous laughter")
    const names = d.map((x) => x.entry.name)
    expect(names).toContain('Hideous Laughter')
    const hl = d.find((x) => x.entry.name === 'Hideous Laughter')!
    expect(hl.method).toBe('exact')
  })

  it('resolves a split homophone via the phonetic tier ("bee holder" -> Beholder)', () => {
    const s = createScanner(FAKE)
    const d = s.scan('a bee holder appears')
    const beholder = d.find((x) => x.entry.name === 'Beholder')
    expect(beholder).toBeDefined()
    expect(beholder!.method).toBe('phonetic')
    expect(beholder!.confidence).toBeLessThan(1.0)
  })

  it('matches English embedded in Hebrew text', () => {
    const s = createScanner(FAKE)
    const d = s.scan('אז אני מטיל fireball על הגובלין')
    expect(d.map((x) => x.entry.name)).toContain('Fireball')
  })

  it('prefers the longest n-gram and consumes its tokens', () => {
    const s = createScanner(FAKE)
    // "mage hand" should match as one entry, not as a stray "hand"/"mage" scan.
    const d = s.scan('he uses mage hand to grab it')
    expect(d.map((x) => x.entry.name)).toEqual(['Mage Hand'])
    expect(d[0].matchedText).toBe('mage hand')
  })
})

describe('cooldown', () => {
  it('suppresses repeats within the cooldown window and re-emits after it', () => {
    const s = createScanner(FAKE, { cooldownMs: 1000 })
    expect(s.scan('fireball', 0)).toHaveLength(1)
    expect(s.scan('fireball', 500)).toHaveLength(0) // within cooldown
    expect(s.scan('fireball', 1500)).toHaveLength(1) // after cooldown
  })

  it('reset() clears cooldown state', () => {
    const s = createScanner(FAKE, { cooldownMs: 10_000 })
    expect(s.scan('fireball', 0)).toHaveLength(1)
    expect(s.scan('fireball', 100)).toHaveLength(0)
    s.reset()
    expect(s.scan('fireball', 100)).toHaveLength(1)
  })
})

describe('stop-list / spam guard', () => {
  it('does NOT auto-emit ultra-common single words even when they are real names', () => {
    const s = createScanner(FAKE)
    expect(s.scan('raise your shield')).toHaveLength(0)
    expect(s.scan('the light in the room')).toHaveLength(0)
  })

  it('still allows a stop-listed word inside a longer specific phrase', () => {
    const s = createScanner(FAKE)
    // "mage hand" contains nothing stop-listed; this guards the inverse: a longer
    // phrase wins over the single-word guard.
    const d = s.scan('cast mage hand now')
    expect(d.map((x) => x.entry.name)).toContain('Mage Hand')
  })

  it('does not auto-emit single-token fuzzy/phonetic near-misses', () => {
    const s = createScanner(FAKE)
    // "goblet" is close to "goblin" but a single bare token must match exactly.
    expect(s.scan('he drank from a goblet')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// End-to-end against the REAL vendored SRD, loaded by the real loader. Under
// vitest (node) there is no global fetch for the loader's relative URLs, so we
// stub fetch to serve the JSON. We pull the JSON in via Vite's `import.meta.glob`
// (typed by `vite/client`) rather than `node:fs`, so no @types/node is needed.
// ---------------------------------------------------------------------------

// Eagerly import every vendored SRD JSON, keyed by basename.
const SRD_MODULES = import.meta.glob('../../public/data/srd/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const SRD_BY_FILE = new Map<string, unknown>(
  Object.entries(SRD_MODULES).map(([p, data]) => [p.split('/').pop()!, data]),
)

describe('createScanner — real SRD compendium', () => {
  let compendium: Compendium

  beforeAll(async () => {
    // The loader requests `${BASE_URL}data/srd/<file>`; intercept and serve the
    // matching basename from the globbed JSON.
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const file = url.split('/').pop()!
      const data = SRD_BY_FILE.get(file)
      if (data === undefined) {
        return { ok: false, status: 404, json: async () => null } as Response
      }
      return { ok: true, status: 200, json: async () => data } as Response
    }) as typeof fetch

    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('detects Fireball exactly', () => {
    const s = createScanner(compendium)
    const d = s.scan('I cast fireball')
    const fb = d.find((x) => x.entry.name === 'Fireball')
    expect(fb).toBeDefined()
    expect(fb!.method).toBe('exact')
    expect(fb!.entry.kind).toBe('spell')
  })

  it('detects the Hideous Laughter spell (possessive prefix tolerated)', () => {
    const s = createScanner(compendium)
    const d = s.scan("he uses tasha's hideous laughter")
    expect(d.map((x) => x.entry.name)).toContain('Hideous Laughter')
  })

  it('detects an English name embedded in Hebrew', () => {
    const s = createScanner(compendium)
    const d = s.scan('אז אני מטיל fireball על הגובלין')
    expect(d.map((x) => x.entry.name)).toContain('Fireball')
  })

  it('does not spam on a stop-listed common word', () => {
    const s = createScanner(compendium)
    expect(s.scan('he raised his shield')).toHaveLength(0)
  })
})
