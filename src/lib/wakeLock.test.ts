// Tests for the Screen Wake Lock wrapper. Stubs `navigator` the same way
// useAppStore.persist.test.ts stubs `localStorage`, so no jsdom config is
// needed — the module only ever touches `navigator.wakeLock`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { acquireWakeLock, releaseWakeLock, hasWakeLock } from './wakeLock'

function makeSentinel() {
  return {
    released: false,
    release: vi.fn(async function (this: { released: boolean }) {
      this.released = true
    }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('wakeLock (unsupported browser)', () => {
  beforeEach(() => {
    // No `wakeLock` property at all — mirrors iOS Safari.
    vi.stubGlobal('navigator', {})
  })

  it('acquireWakeLock does not throw and leaves no lock held', async () => {
    await expect(acquireWakeLock()).resolves.toBeUndefined()
    expect(hasWakeLock()).toBe(false)
  })

  it('releaseWakeLock is a safe no-op with nothing held', async () => {
    await expect(releaseWakeLock()).resolves.toBeUndefined()
  })
})

describe('wakeLock (supported browser)', () => {
  let request: ReturnType<typeof vi.fn>
  let sentinel: ReturnType<typeof makeSentinel>

  beforeEach(() => {
    sentinel = makeSentinel()
    request = vi.fn().mockResolvedValue(sentinel)
    vi.stubGlobal('navigator', { wakeLock: { request } })
  })

  it('acquireWakeLock requests a "screen" lock and hasWakeLock reflects it', async () => {
    await acquireWakeLock()
    expect(request).toHaveBeenCalledWith('screen')
    expect(hasWakeLock()).toBe(true)
  })

  it('releaseWakeLock releases the held sentinel and clears state', async () => {
    await acquireWakeLock()
    await releaseWakeLock()
    expect(sentinel.release).toHaveBeenCalled()
    expect(hasWakeLock()).toBe(false)
  })

  it('swallows a rejected request() instead of throwing', async () => {
    request.mockRejectedValueOnce(new DOMException('NotAllowedError'))
    await expect(acquireWakeLock()).resolves.toBeUndefined()
    expect(hasWakeLock()).toBe(false)
  })

  it('swallows a rejected release() instead of throwing', async () => {
    await acquireWakeLock()
    sentinel.release.mockRejectedValueOnce(new DOMException('InvalidStateError'))
    await expect(releaseWakeLock()).resolves.toBeUndefined()
  })

  it('hasWakeLock returns false once the sentinel reports released', async () => {
    await acquireWakeLock()
    sentinel.released = true
    expect(hasWakeLock()).toBe(false)
  })
})
