import { beforeAll, describe, expect, it } from 'vitest'
import { normalize, phoneticKey } from '../lib/text'
import type { Compendium } from '../compendium/loader'
import type { CompendiumEntry, EntryKind } from '../compendium/types'
import { createScanner } from './scanner'
import { installSrdFetch } from '../test/srdFetch'

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
// stub fetch to serve the JSON. installSrdFetch() is shared from src/test/srdFetch.ts.
// ---------------------------------------------------------------------------

describe('createScanner — real SRD compendium (basic)', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
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

// ---------------------------------------------------------------------------
// Expanded real-SRD tests covering the full REGRESSIONS.md checklist.
// All tests in this describe share the same compendium instance loaded above.
// ---------------------------------------------------------------------------

describe('createScanner — real SRD: run-together multi-word names', () => {
  // STT drops spaces: "Fire Bolt" -> "firebolt", "Magic Missile" -> "magicmissile".
  // The loader's makeAliases indexes the no-space form so it resolves at the exact tier.
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('resolves run-together "firebolt" to Fire Bolt (exact via no-space alias)', () => {
    const s = createScanner(compendium)
    const d = s.scan('firebolt')
    const fb = d.find((x) => x.entry.name === 'Fire Bolt')
    expect(fb).toBeDefined()
    expect(fb!.method).toBe('exact')
  })

  it('resolves run-together "magicmissile" to Magic Missile (exact via no-space alias)', () => {
    const s = createScanner(compendium)
    const d = s.scan('magicmissile')
    const mm = d.find((x) => x.entry.name === 'Magic Missile')
    expect(mm).toBeDefined()
    expect(mm!.method).toBe('exact')
  })

  it('resolves run-together "lightningbolt" to Lightning Bolt', () => {
    const s = createScanner(compendium)
    const d = s.scan('lightningbolt')
    expect(d.map((x) => x.entry.name)).toContain('Lightning Bolt')
  })
})

describe('createScanner — real SRD: split single-word names', () => {
  // "fire ball" spoken as two tokens -> Fireball via phonetic concatenation.
  // "fire bolt" as two tokens -> Fire Bolt via exact (the spaced alias).
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('resolves "fire ball" (two tokens) to Fireball via phonetic tier', () => {
    // The scanner tries phonetic('fireball') (concatenated) which matches Fireball's
    // phonetic index key.
    const s = createScanner(compendium)
    const d = s.scan('fire ball')
    const fb = d.find((x) => x.entry.name === 'Fireball')
    expect(fb).toBeDefined()
    expect(fb!.method).toBe('phonetic')
  })

  it('resolves "fire bolt" (two tokens) to Fire Bolt via exact tier', () => {
    // "fire bolt" is the canonical spaced alias and matches at the exact tier.
    const s = createScanner(compendium)
    const d = s.scan('fire bolt')
    const fb = d.find((x) => x.entry.name === 'Fire Bolt')
    expect(fb).toBeDefined()
    expect(fb!.method).toBe('exact')
  })

  it('"fire ball" match is Fireball, not also emitting spurious single tokens', () => {
    // Greedy: "fire ball" consumed as one match means neither "fire" nor "ball"
    // re-triggers a spurious detection.
    const s = createScanner(compendium)
    const d = s.scan('fire ball')
    // Must have matched something (non-empty guard so the every() is not vacuously true).
    expect(d.length).toBeGreaterThan(0)
    // Only one detection, and it must be Fireball
    expect(d.every((x) => x.entry.name === 'Fireball')).toBe(true)
  })
})

describe('createScanner — real SRD: English in Hebrew', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('detects Fireball and Goblin from a mixed Hebrew/English sentence', () => {
    // "אז אני מטיל fireball על הgoblin" — Hebrew ignored, Latin tokens matched.
    const s = createScanner(compendium)
    const d = s.scan('אז אני מטיל fireball על הgoblin')
    const names = d.map((x) => x.entry.name)
    expect(names).toContain('Fireball')
    expect(names).toContain('Goblin')
  })

  it('does NOT detect anything from a purely Hebrew-script sentence', () => {
    // Hebrew-script transliterations of game terms are NOT matched — this documents
    // the current limitation until cross-script matching is implemented.
    const s = createScanner(compendium)
    const d = s.scan('מטיל פיירבול') // "casting fireball" but all Hebrew
    expect(d).toHaveLength(0)
  })

  it('detects multiple English terms scattered through Hebrew prose', () => {
    const s = createScanner(compendium)
    const d = s.scan('השודד מטיל magic missile ואז goblin תוקף')
    const names = d.map((x) => x.entry.name)
    expect(names).toContain('Magic Missile')
    expect(names).toContain('Goblin')
  })
})

describe('createScanner — real SRD: possessive / apostrophe handling', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('resolves "tasha\'s hideous laughter" to Hideous Laughter', () => {
    // normalize() strips the possessive "tasha's" -> "tashas"; the scanner skips
    // that token and then matches "hideous laughter" exactly.
    const s = createScanner(compendium)
    const d = s.scan("tasha's hideous laughter")
    const hl = d.find((x) => x.entry.name === 'Hideous Laughter')
    expect(hl).toBeDefined()
    expect(hl!.method).toBe('exact')
  })

  it('resolves "hunter\'s mark" to Hunter\'s Mark', () => {
    const s = createScanner(compendium)
    const d = s.scan("hunter's mark")
    expect(d.map((x) => x.entry.name)).toContain("Hunter's Mark")
  })
})

describe('createScanner — real SRD: phonetic typo tolerance', () => {
  // Deepgram/Soniox STT produces phonetically similar misspellings; the phonetic
  // index (double-metaphone) catches these so the match still fires.
  //
  // NOTE: The specific phonetic codes asserted below (e.g. "blest" ≅ "blast",
  // "missael" ≅ "missile") depend on the `double-metaphone` library's output.
  // If that library is upgraded or replaced, re-verify these expectations and
  // update them to match the new library's codes.
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('"magic missael" resolves to Magic Missile via phonetic tier', () => {
    // missael -> MSL, missile -> MSL: same phonetic code.
    const s = createScanner(compendium)
    const d = s.scan('magic missael')
    const mm = d.find((x) => x.entry.name === 'Magic Missile')
    expect(mm).toBeDefined()
    expect(mm!.method).toBe('phonetic')
    expect(mm!.confidence).toBeLessThan(1.0)
  })

  it('"magic missal" resolves to Magic Missile via phonetic tier', () => {
    const s = createScanner(compendium)
    const d = s.scan('magic missal')
    const mm = d.find((x) => x.entry.name === 'Magic Missile')
    expect(mm).toBeDefined()
    expect(mm!.method).toBe('phonetic')
  })

  it('"eldritch blest" exercises the phonetic tier (blest/blast share a metaphone code)', () => {
    // "blest" and "blast" both produce the PLST double-metaphone code, so this
    // utterance should hit the phonetic tier and match Eldritch Blast. The test
    // documents that phonetic sensitivity is intentionally broad for near-homophones.
    const s = createScanner(compendium)
    const d = s.scan('eldritch blest')
    // All returned detections must have valid confidence scores.
    expect(d.every((x) => x.confidence > 0 && x.confidence <= 1.0)).toBe(true)
    // We expect a phonetic match because blest ≅ blast in double-metaphone.
    expect(d.some((x) => x.entry.name === 'Eldritch Blast')).toBe(true)
  })
})

describe('createScanner — real SRD: single-word stop-list', () => {
  // Common English words that double as SRD entries must NOT auto-emit on bare
  // utterance but remain findable via compendium.search.
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('"shield" alone does not auto-emit', () => {
    const s = createScanner(compendium)
    expect(s.scan('shield')).toHaveLength(0)
  })

  it('"fire" alone does not auto-emit', () => {
    const s = createScanner(compendium)
    expect(s.scan('fire')).toHaveLength(0)
  })

  it('"fly" alone does not auto-emit', () => {
    const s = createScanner(compendium)
    expect(s.scan('fly')).toHaveLength(0)
  })

  it('"light" alone does not auto-emit', () => {
    const s = createScanner(compendium)
    expect(s.scan('light')).toHaveLength(0)
  })

  it('"web" alone does not auto-emit', () => {
    const s = createScanner(compendium)
    expect(s.scan('web')).toHaveLength(0)
  })

  it('"sleep" alone does not auto-emit', () => {
    const s = createScanner(compendium)
    expect(s.scan('sleep')).toHaveLength(0)
  })

  it('stop-listed "shield" IS findable via compendium.search', () => {
    // Manual search must still work even when auto-emit is suppressed.
    const results = compendium.search('shield')
    const names = results.map((e) => e.name)
    expect(names.some((n) => n.toLowerCase() === 'shield')).toBe(true)
  })

  it('stop-listed "fly" IS findable via compendium.search', () => {
    const results = compendium.search('fly')
    expect(results.some((e) => e.name.toLowerCase() === 'fly')).toBe(true)
  })

  it('"wall of fire" is NOT stop-listed (multi-word context is specific)', () => {
    // "fire" is stop-listed for single bare tokens; "wall of fire" is specific.
    const s = createScanner(compendium)
    const d = s.scan('wall of fire')
    expect(d.map((x) => x.entry.name)).toContain('Wall of Fire')
  })
})

describe('createScanner — real SRD: greedy longest-match', () => {
  // When a multi-word span is matched, the individual sub-tokens must NOT also
  // emit separate detections.
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('"magic missile" matches as Magic Missile, not emitting "magic" separately', () => {
    const s = createScanner(compendium)
    const d = s.scan('magic missile')
    expect(d.map((x) => x.entry.name)).toContain('Magic Missile')
    // "magic" alone is stop-listed so it could never fire; but even if it weren't,
    // greedy consumption would skip it.  Assert no stray single-token hit.
    expect(d.filter((x) => x.matchedText === 'magic')).toHaveLength(0)
  })

  it('"eldritch blast" matches as Eldritch Blast; "blast" is not re-scanned', () => {
    const s = createScanner(compendium)
    const d = s.scan('eldritch blast')
    expect(d.map((x) => x.entry.name)).toContain('Eldritch Blast')
    expect(d.filter((x) => x.matchedText === 'blast')).toHaveLength(0)
  })

  it('"fireball" and "goblin" both detected with correct matched text', () => {
    const s = createScanner(compendium)
    const d = s.scan('fireball goblin')
    const names = d.map((x) => x.entry.name)
    expect(names).toContain('Fireball')
    expect(names).toContain('Goblin')
    const fb = d.find((x) => x.entry.name === 'Fireball')!
    expect(fb.matchedText).toBe('fireball')
  })
})

describe('createScanner — real SRD: cooldown with injectable now', () => {
  let compendium: Compendium

  beforeAll(async () => {
    installSrdFetch()
    const { loadCompendium } = await import('../compendium/loader')
    compendium = await loadCompendium()
  })

  it('suppresses repeat Fireball within cooldown window', () => {
    const s = createScanner(compendium, { cooldownMs: 5000 })
    expect(s.scan('fireball', 0)).toHaveLength(1)
    expect(s.scan('fireball', 2000)).toHaveLength(0) // 2s < 5s cooldown
    expect(s.scan('fireball', 6000)).toHaveLength(1) // 6s > 5s cooldown
  })

  it('independent entries have independent cooldowns', () => {
    const s = createScanner(compendium, { cooldownMs: 5000 })
    s.scan('fireball', 0)
    s.scan('magic missile', 0)
    // Both suppressed at t=1000
    expect(s.scan('fireball', 1000)).toHaveLength(0)
    expect(s.scan('magic missile', 1000)).toHaveLength(0)
    // Both re-emit at t=6000
    expect(s.scan('fireball', 6000)).toHaveLength(1)
    expect(s.scan('magic missile', 6000)).toHaveLength(1)
  })

  it('reset() clears cooldown so entries re-emit immediately', () => {
    const s = createScanner(compendium, { cooldownMs: 30_000 })
    s.scan('fireball', 0)
    expect(s.scan('fireball', 1000)).toHaveLength(0)
    s.reset()
    expect(s.scan('fireball', 1000)).toHaveLength(1)
  })
})
