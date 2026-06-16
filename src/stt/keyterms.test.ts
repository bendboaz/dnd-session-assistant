import { describe, it, expect } from 'vitest'
import { buildKeyterms } from './keyterms'

describe('buildKeyterms', () => {
  it('puts pinned names first, then defaults', () => {
    expect(buildKeyterms(['Counterspell', 'Bless'], ['Fireball', 'Goblin'])).toEqual([
      'Counterspell',
      'Bless',
      'Fireball',
      'Goblin',
    ])
  })

  it('drops a default that duplicates a pinned name (case-insensitive), keeping the pinned form', () => {
    expect(buildKeyterms(['Fireball'], ['fireball', 'Goblin'])).toEqual(['Fireball', 'Goblin'])
  })

  it('de-dupes within the pinned list, keeping the first occurrence', () => {
    expect(buildKeyterms(['Fireball', 'FIREBALL'], [])).toEqual(['Fireball'])
  })

  it('de-dupes within the defaults list', () => {
    expect(buildKeyterms([], ['Goblin', 'goblin', 'Orc'])).toEqual(['Goblin', 'Orc'])
  })

  it('handles empty pinned', () => {
    expect(buildKeyterms([], ['Fireball', 'Goblin'])).toEqual(['Fireball', 'Goblin'])
  })

  it('handles empty defaults', () => {
    expect(buildKeyterms(['Fireball'], [])).toEqual(['Fireball'])
  })

  it('handles both empty', () => {
    expect(buildKeyterms([], [])).toEqual([])
  })

  it('does not mutate its inputs', () => {
    const pinned = ['Fireball']
    const defaults = ['fireball', 'Goblin']
    buildKeyterms(pinned, defaults)
    expect(pinned).toEqual(['Fireball'])
    expect(defaults).toEqual(['fireball', 'Goblin'])
  })
})
