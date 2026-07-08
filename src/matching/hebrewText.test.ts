import { describe, expect, it } from 'vitest'
import { hebrewTokens, romanizeVariants, HEBREW_STOP_WORDS } from './hebrewText'

describe('hebrewTokens', () => {
  it('extracts a single Hebrew word', () => {
    expect(hebrewTokens('פיירבול')).toEqual(['פיירבול'])
  })

  it('splits multiple Hebrew words separated by spaces', () => {
    expect(hebrewTokens('מטיל פיירבול')).toEqual(['מטיל', 'פיירבול'])
  })

  it('ignores Latin runs and only extracts Hebrew ones', () => {
    expect(hebrewTokens('אז אני מטיל fireball על הgoblin')).toEqual([
      'אז',
      'אני',
      'מטיל',
      'על',
      'ה',
    ])
  })

  it('returns an empty array for pure Latin text', () => {
    expect(hebrewTokens('fireball goblin')).toEqual([])
  })

  it('strips niqqud/cantillation marks from a pointed word', () => {
    // "כַּדּוּר" with niqqud should tokenize down to the base letters "כדור".
    expect(hebrewTokens('כַּדּוּר')).toEqual(['כדור'])
  })

  it('returns an empty array for empty input', () => {
    expect(hebrewTokens('')).toEqual([])
  })
})

describe('romanizeVariants', () => {
  it('produces plausible Latin variants for a Hebraized word', () => {
    // גובלין (goblin, Hebraized) should include the exact Latin spelling
    // among its plausible romanizations.
    const variants = romanizeVariants('גובלין')
    expect(variants.length).toBeGreaterThan(0)
    expect(variants).toContain('goblin')
  })

  it('returns an empty array for a token with no mappable letters', () => {
    expect(romanizeVariants('')).toEqual([])
  })

  it('returns a bounded number of variants (no combinatorial explosion)', () => {
    // A long token with several ambiguous letters must still stay bounded.
    const variants = romanizeVariants('פיירבולשששש')
    expect(variants.length).toBeLessThanOrEqual(12)
  })

  it('drops silent alef/ayin placeholders in at least one variant', () => {
    const variants = romanizeVariants('אבא') // alef-bet-alef
    expect(variants.length).toBeGreaterThan(0)
  })
})

describe('HEBREW_STOP_WORDS', () => {
  it('contains common function words / verbs that appear in every session', () => {
    expect(HEBREW_STOP_WORDS.has('מטיל')).toBe(true)
    expect(HEBREW_STOP_WORDS.has('אז')).toBe(true)
    expect(HEBREW_STOP_WORDS.has('אני')).toBe(true)
  })

  it('does not contain a curated game-term alias like פיירבול', () => {
    expect(HEBREW_STOP_WORDS.has('פיירבול')).toBe(false)
  })
})
