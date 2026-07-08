import { describe, expect, it } from 'vitest'
import { resolveHebrewAlias, HEBREW_MAX_ALIAS_WORDS } from './hebrewAliases'

describe('resolveHebrewAlias', () => {
  it('resolves the primary curated Fireball alias', () => {
    expect(resolveHebrewAlias('פיירבול')).toBe('fireball')
  })

  it('resolves the Hebrew-translated Fireball alias', () => {
    expect(resolveHebrewAlias('כדור אש')).toBe('fireball')
  })

  it('resolves curated Magic Missile aliases', () => {
    expect(resolveHebrewAlias('קסם טיל')).toBe('magic missile')
    expect(resolveHebrewAlias('חץ קסם')).toBe('magic missile')
  })

  it('resolves a curated Fire Bolt alias', () => {
    expect(resolveHebrewAlias('ניצוץ אש')).toBe('fire bolt')
  })

  it('tolerates surrounding whitespace and repeated internal spaces', () => {
    expect(resolveHebrewAlias('  כדור   אש  ')).toBe('fireball')
  })

  it('returns undefined for an uncurated phrase', () => {
    expect(resolveHebrewAlias('שלום עולם')).toBeUndefined()
  })
})

describe('HEBREW_MAX_ALIAS_WORDS', () => {
  it('reflects the widest curated phrase (in words)', () => {
    expect(HEBREW_MAX_ALIAS_WORDS).toBeGreaterThanOrEqual(2)
  })
})
