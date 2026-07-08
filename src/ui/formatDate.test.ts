import { describe, expect, it } from 'vitest'
import { formatStartedAt } from './formatDate'

describe('formatStartedAt', () => {
  it('falls back to "Unknown date" for null', () => {
    expect(formatStartedAt(null)).toBe('Unknown date')
  })

  it('falls back to "Unknown date" for an unparseable string', () => {
    expect(formatStartedAt('not-a-date')).toBe('Unknown date')
  })

  it('formats a valid ISO timestamp', () => {
    // A 4-digit year somewhere in the output is enough to confirm this went
    // through toLocaleString rather than falling back — not hardcoding the
    // specific year so this doesn't bit-rot as a "wrong reason" failure later.
    expect(formatStartedAt('2026-01-15T10:30:00Z')).toMatch(/\d{4}/)
  })
})
