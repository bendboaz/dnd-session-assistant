import { describe, it, expect, vi, afterEach } from 'vitest'
import { postNearMisses } from './transcript'
import type { NearMissPayload } from './transcript'

const SESSION = 'abc123'
const NEAR_MISS: NearMissPayload = { token: 'firebolt', context: 'i cast firebolt', ts: 1000 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('postNearMisses', () => {
  it('returns early without fetching when array is empty', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    await postNearMisses(SESSION, [])
    expect(spy).not.toHaveBeenCalled()
  })

  it('POSTs near-misses to the correct endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    await postNearMisses(SESSION, [NEAR_MISS])
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`/api/sessions/${SESSION}/near-misses`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as { near_misses: NearMissPayload[] }
    expect(body.near_misses).toEqual([NEAR_MISS])
  })

  it('silently ignores 403 (data collection disabled server-side)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }))
    // Must not throw or warn about the 403
    const warnSpy = vi.spyOn(console, 'warn')
    await postNearMisses(SESSION, [NEAR_MISS])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('swallows non-403 error responses (e.g. 500)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))
    const warnSpy = vi.spyOn(console, 'warn')
    await postNearMisses(SESSION, [NEAR_MISS])
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain('postNearMisses')
  })

  it('swallows fetch network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const warnSpy = vi.spyOn(console, 'warn')
    await postNearMisses(SESSION, [NEAR_MISS])
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain('postNearMisses')
  })
})
