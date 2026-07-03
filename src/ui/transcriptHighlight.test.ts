// Tests for locateDetections: mapping normalized Detection.matchedText phrases
// back onto character ranges in the original (un-normalized) transcript text.

import { describe, expect, it } from 'vitest'
import { locateDetections } from './transcriptHighlight'
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
})
