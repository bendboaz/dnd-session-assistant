// Tests for locateDetections: mapping normalized Detection.matchedText phrases
// back onto character ranges in the original (un-normalized) transcript text.

import { describe, expect, it } from 'vitest'
import { locateDetections, rawTokensWithSpans } from './transcriptHighlight'
import { latinTokens } from '../lib/text'
import type { Detection } from '../matching/types'
import type { CompendiumEntry } from '../compendium/types'

function fakeEntry(id: string, name: string): CompendiumEntry {
  return {
    id,
    name,
    aliases: [name.toLowerCase()],
    kind: 'spell',
    source: 'srd',
    data: {
      level: 3,
      school: 'evocation',
      castingTime: '1 action',
      range: '150 feet',
      components: ['V', 'S', 'M'],
      duration: 'Instantaneous',
      concentration: false,
      ritual: false,
      classes: ['Wizard'],
      desc: [],
      higherLevel: [],
    },
  }
}

function det(entry: CompendiumEntry, matchedText: string): Detection {
  return { entry, matchedText, method: 'exact', confidence: 1, ts: 1000 }
}

describe('locateDetections', () => {
  it('finds a single-word match and returns its exact span', () => {
    const fireball = fakeEntry('srd:spell:fireball', 'Fireball')
    const text = 'I cast Fireball at the goblins'
    const ranges = locateDetections(text, [det(fireball, 'fireball')])

    expect(ranges).toHaveLength(1)
    const [r] = ranges
    expect(text.slice(r.start, r.end)).toBe('Fireball')
  })

  it('finds a multi-word phrase spanning two raw tokens', () => {
    const mageHand = fakeEntry('srd:spell:mage-hand', 'Mage Hand')
    const text = "the wizard casts mage hand on the door"
    const ranges = locateDetections(text, [det(mageHand, 'mage hand')])

    expect(ranges).toHaveLength(1)
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('mage hand')
  })

  it('handles possessive normalization (Tasha\'s -> tashas)', () => {
    const laughter = fakeEntry('srd:spell:thl', "Tasha's Hideous Laughter")
    const text = "she casts Tasha's Hideous Laughter"
    const ranges = locateDetections(text, [
      det(laughter, 'tashas hideous laughter'),
    ])

    expect(ranges).toHaveLength(1)
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe("Tasha's Hideous Laughter")
  })

  it('locates multiple non-overlapping detections in order', () => {
    const fireball = fakeEntry('srd:spell:fireball', 'Fireball')
    const shield = fakeEntry('srd:spell:shield-spell', 'Shield')
    const text = 'first fireball then shield spell'
    const ranges = locateDetections(text, [
      det(fireball, 'fireball'),
      det(shield, 'shield spell'),
    ])

    expect(ranges).toHaveLength(2)
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('fireball')
    expect(text.slice(ranges[1].start, ranges[1].end)).toBe('shield spell')
    // Second range must start after the first ends.
    expect(ranges[1].start).toBeGreaterThan(ranges[0].end)
  })

  it('skips a detection whose phrase cannot be found in the text', () => {
    const fireball = fakeEntry('srd:spell:fireball', 'Fireball')
    const text = 'no spells were cast here'
    const ranges = locateDetections(text, [det(fireball, 'fireball')])
    expect(ranges).toHaveLength(0)
  })

  it('returns [] for no detections', () => {
    expect(locateDetections('some text', [])).toEqual([])
  })

  it('locates two detections that sit back-to-back with no gap between them', () => {
    const fireBolt = fakeEntry('srd:spell:fire-bolt', 'Fire Bolt')
    const shield = fakeEntry('srd:spell:shield-spell', 'Shield spell')
    const text = 'fire bolt shield spell'
    const ranges = locateDetections(text, [
      det(fireBolt, 'fire bolt'),
      det(shield, 'shield spell'),
    ])

    expect(ranges).toHaveLength(2)
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('fire bolt')
    expect(text.slice(ranges[1].start, ranges[1].end)).toBe('shield spell')
    // No off-by-one in the cursor advance: the second range must start exactly
    // where the first ends (only the separating space between them).
    expect(ranges[1].start).toBe(ranges[0].end + 1)
  })
})

describe('rawTokensWithSpans', () => {
  // Regression guard for the module-comment's stated risk: this file's token
  // regex is a hand-duplicated copy of lib/text.ts's latinTokens (a frozen
  // contract file, so it can't be changed to export the pattern for reuse). If
  // the two ever diverge, detections would silently stop lining up with the
  // raw text — this test cross-checks their tokenization stays identical.
  it.each([
    'I cast Fireball at the goblins',
    "she casts Tasha's Hideous Laughter",
    'a beholder, a mimic; and a lich!',
    'a half-elf ranger draws her longbow', // neither regex includes '-', so both split into "half", "elf"
    'cast 3 fireballs, roll 2d6 damage', // neither regex's leading char class includes digits
    'no spells were cast here',
    '',
  ])('tokenizes the same words as latinTokens for %j', (text) => {
    expect(rawTokensWithSpans(text).map((t) => t.norm)).toEqual(latinTokens(text))
  })
})
