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
    expect(formatStartedAt('2026-01-15T10:30:00Z')).not.toBe('Unknown date')
  })
})
