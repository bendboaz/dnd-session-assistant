// Unit tests for SonioxProvider helpers.
//
// These tests cover three orthogonal concerns:
//   1. Control-marker stripping — `<end>`, `<start>`, `<noise>` must never
//      appear in emitted segment text.
//   2. Opening config frame shape — `language_hints` and context terms must be
//      present and well-formed.
//   3. `dedupeClamp` (the clampKeyterms implementation) — cap at 100 and
//      case-insensitive deduplication.

import { describe, it, expect } from 'vitest'
import {
  buildSonioxOpeningFrame,
  dedupeClamp,
  parseSonioxMessage,
} from './SonioxProvider'

// ---------------------------------------------------------------------------
// 1. Control-marker stripping
// ---------------------------------------------------------------------------

describe('parseSonioxMessage — control marker stripping', () => {
  function makeMessage(tokens: Array<{ text: string; is_final?: boolean }>) {
    return JSON.stringify({ tokens })
  }

  it('strips <end> from a final token', () => {
    const segs = parseSonioxMessage(makeMessage([{ text: 'שלום<end>', is_final: true }]))
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('שלום')
    expect(segs[0].text).not.toContain('<end>')
  })

  it('strips <start> from a token', () => {
    const segs = parseSonioxMessage(makeMessage([{ text: '<start>שלום', is_final: true }]))
    expect(segs).toHaveLength(1)
    expect(segs[0].text).not.toContain('<start>')
  })

  it('strips <noise> from a token', () => {
    const segs = parseSonioxMessage(makeMessage([{ text: '<noise>', is_final: true }]))
    // After stripping the entire text is empty, so the segment is filtered out.
    expect(segs).toHaveLength(0)
  })

  it('strips multiple markers in one token text', () => {
    const segs = parseSonioxMessage(
      makeMessage([{ text: '<start>hello<end>', is_final: true }]),
    )
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('hello')
  })

  it('strips <end> from an interim token', () => {
    const segs = parseSonioxMessage(makeMessage([{ text: 'fireball<end>', is_final: false }]))
    expect(segs).toHaveLength(1)
    expect(segs[0].text).not.toContain('<end>')
  })

  it('does not affect normal text without markers', () => {
    const segs = parseSonioxMessage(
      makeMessage([{ text: 'הקוסם מטיל fireball', is_final: true }]),
    )
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('הקוסם מטיל fireball')
  })

  it('filters out a segment whose text is entirely a marker', () => {
    const segs = parseSonioxMessage(makeMessage([{ text: '<end>', is_final: true }]))
    expect(segs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Opening config frame shape
// ---------------------------------------------------------------------------

describe('buildSonioxOpeningFrame', () => {
  it('includes language_hints', () => {
    const frame = buildSonioxOpeningFrame('tok', [])
    expect(frame).toHaveProperty('language_hints')
    expect(Array.isArray(frame.language_hints)).toBe(true)
    const hints = frame.language_hints as string[]
    expect(hints).toContain('he')
    expect(hints).toContain('en')
  })

  it('includes context.terms when keyterms are provided', () => {
    const frame = buildSonioxOpeningFrame('tok', ['Fireball', 'Goblin'])
    expect(frame).toHaveProperty('context')
    const ctx = frame.context as { terms: string[] }
    expect(ctx.terms).toEqual(['Fireball', 'Goblin'])
  })

  it('omits context when keyterms list is empty', () => {
    const frame = buildSonioxOpeningFrame('tok', [])
    expect(frame).not.toHaveProperty('context')
  })

  it('embeds the token as api_key', () => {
    const frame = buildSonioxOpeningFrame('my-token', [])
    expect(frame.api_key).toBe('my-token')
  })
})

// ---------------------------------------------------------------------------
// 3. dedupeClamp
// ---------------------------------------------------------------------------

describe('dedupeClamp', () => {
  it('caps the list to the given limit', () => {
    const input = Array.from({ length: 150 }, (_, i) => `Term${i}`)
    expect(dedupeClamp(input, 100)).toHaveLength(100)
  })

  it('does not exceed ~100 terms when called with the default cap', () => {
    const input = Array.from({ length: 200 }, (_, i) => `Term${i}`)
    const result = dedupeClamp(input, 100)
    expect(result.length).toBeLessThanOrEqual(100)
  })

  it('deduplicates case-insensitively, keeping the first form', () => {
    const result = dedupeClamp(['Fireball', 'fireball'], 100)
    expect(result).toEqual(['Fireball'])
  })

  it('deduplicates across mixed-case variants', () => {
    const result = dedupeClamp(['FIREBALL', 'Fireball', 'fireball'], 100)
    expect(result).toEqual(['FIREBALL'])
  })

  it('preserves order of first occurrences', () => {
    const result = dedupeClamp(['Goblin', 'Fireball', 'goblin', 'Orc'], 100)
    expect(result).toEqual(['Goblin', 'Fireball', 'Orc'])
  })

  it('drops empty or whitespace-only terms', () => {
    const result = dedupeClamp(['Fireball', '', '  ', 'Goblin'], 100)
    expect(result).toEqual(['Fireball', 'Goblin'])
  })

  it('returns an empty array for empty input', () => {
    expect(dedupeClamp([], 100)).toEqual([])
  })
})
