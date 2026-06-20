import { describe, it, expect, vi, afterEach } from 'vitest'
import { postNearMisses, postTranscript } from './transcript'
import type { NearMissPayload } from './transcript'
import type { TranscriptSegment } from '../stt/types'

const SESSION = 'abc123'
const NEAR_MISS: NearMissPayload = { token: 'firebolt', context: 'i cast firebolt', ts: 1000 }
const SEG: TranscriptSegment = { text: 'fireball', ts: 1000, isFinal: true }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('postNearMisses', () => {
  it('returns early without fetching when array is empty', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    await postNearMisses(SESSION, [])
    expect(spy).not.toHaveBeenCalled()
  })

  it('POSTs near-misses to the correct endpoint', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    await postNearMisses(SESSION, [NEAR_MISS])
    expect(spy).toHaveBeenCalledOnce()
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`/api/sessions/${SESSION}/near-misses`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as { near_misses: NearMissPayload[] }
    expect(body.near_misses).toEqual([NEAR_MISS])
  })

  it('silently ignores 403 (data collection disabled server-side)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }))
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

function makeFetch(status: number, ok: boolean): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => ({}) } as Response)
}

describe('postTranscript', () => {
  it('returns ok early without fetching when segments is empty', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const result = await postTranscript('session-1', [])
    expect(result).toBe('ok')
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns stale on 404', async () => {
    vi.stubGlobal('fetch', makeFetch(404, false))
    const result = await postTranscript('session-1', [SEG])
    expect(result).toBe('stale')
  })

  it('returns ok on 200', async () => {
    vi.stubGlobal('fetch', makeFetch(200, true))
    const result = await postTranscript('session-1', [SEG])
    expect(result).toBe('ok')
  })

  it('returns ok (swallowed) on non-404 error status', async () => {
    vi.stubGlobal('fetch', makeFetch(500, false))
    const result = await postTranscript('session-1', [SEG])
    expect(result).toBe('ok')
  })

  it('returns ok (swallowed) on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')))
    const result = await postTranscript('session-1', [SEG])
    expect(result).toBe('ok')
  })
})
