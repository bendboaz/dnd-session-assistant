// Unit tests for DeepgramProvider helpers.
//
// Deepgram short-lived grant tokens must be presented via the `bearer`
// subprotocol, NOT `token` (which is for raw long-lived API keys that must
// never reach the browser). This test locks that contract.

import { describe, it, expect } from 'vitest'
import { buildSocketProtocols } from './DeepgramProvider'

describe('buildSocketProtocols (Deepgram WS auth subprotocol)', () => {
  it('returns [\'bearer\', token] for a given token', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.test'
    expect(buildSocketProtocols(token)).toEqual(['bearer', token])
  })

  it('does NOT return [\'token\', token]', () => {
    const token = 'some-token'
    const protocols = buildSocketProtocols(token)
    expect(protocols[0]).not.toBe('token')
  })

  it('places the literal string "bearer" as the first element', () => {
    const protocols = buildSocketProtocols('abc')
    expect(protocols[0]).toBe('bearer')
  })

  it('places the token string as the second element', () => {
    const token = 'grant-jwt-12345'
    const protocols = buildSocketProtocols(token)
    expect(protocols[1]).toBe(token)
  })

  it('returns exactly two elements', () => {
    expect(buildSocketProtocols('tok')).toHaveLength(2)
  })
})
