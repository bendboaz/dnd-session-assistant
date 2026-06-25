// Tests for the transcript client: the localStorage buffer + chunked backfill,
// the auth header / 401 handling, the 'ok' | 'stale' return contract, and
// near-miss posting.
//
// We mock `getIdToken` and `signOut` from the auth module so no Firebase app is
// needed, and stub localStorage via vi.stubGlobal (same pattern as
// useAppStore.persist.test.ts) so the test environment needs no jsdom config.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment } from '../stt/types'

// Top-level vi.mock is hoisted by vitest before any imports execute, so the
// real firebase.ts never runs (and never calls getAuth with a blank API key).
vi.mock('../auth/firebase', () => ({
  getIdToken: vi.fn().mockResolvedValue(null),
  signOut: vi.fn().mockResolvedValue(undefined),
}))

// Import after mocks are declared so the module sees the stubs.
import {
  readQueue,
  enqueueSegments,
  dequeueSegments,
  postTranscript,
  flushQueue,
  postNearMisses,
} from './transcript'
import type { NearMissPayload } from './transcript'
import { getIdToken, signOut } from '../auth/firebase'

// ---- localStorage stub (same helper pattern as useAppStore.persist.test.ts) -

function makeLocalStorageStub() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  }
}

// ---- helpers ----------------------------------------------------------------

function seg(text: string, ts = 1000): TranscriptSegment {
  return { text, isFinal: true, ts }
}

const SESSION = 'abc123'
const NEAR_MISS: NearMissPayload = { token: 'firebolt', context: 'i cast firebolt', ts: 1000 }
const SEG: TranscriptSegment = { text: 'fireball', ts: 1000, isFinal: true }

function makeFetch(status: number, ok: boolean): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => ({}) } as Response)
}

// ---- setup / teardown -------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorageStub())
  vi.mocked(getIdToken).mockReset().mockResolvedValue(null)
  vi.mocked(signOut).mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---- readQueue / enqueueSegments / dequeueSegments --------------------------

describe('readQueue', () => {
  it('returns [] when localStorage is empty', () => {
    expect(readQueue()).toEqual([])
  })

  it('returns [] on corrupt JSON', () => {
    localStorage.setItem('dnd-assistant:transcript-queue', '{bad}')
    expect(readQueue()).toEqual([])
  })

  it('returns [] when stored value is not an array', () => {
    localStorage.setItem('dnd-assistant:transcript-queue', JSON.stringify({ oops: 1 }))
    expect(readQueue()).toEqual([])
  })
})

describe('enqueueSegments', () => {
  it('persists segments with their sessionId', () => {
    enqueueSegments('s1', [seg('hello'), seg('world')])
    const q = readQueue()
    expect(q).toHaveLength(2)
    expect(q[0]).toMatchObject({ sessionId: 's1', text: 'hello' })
    expect(q[1]).toMatchObject({ sessionId: 's1', text: 'world' })
  })

  it('accumulates across multiple calls', () => {
    enqueueSegments('s1', [seg('a')])
    enqueueSegments('s1', [seg('b')])
    expect(readQueue()).toHaveLength(2)
  })

  it('keeps segments from different sessions separate', () => {
    enqueueSegments('s1', [seg('from-s1')])
    enqueueSegments('s2', [seg('from-s2')])
    const q = readQueue()
    expect(q).toHaveLength(2)
    expect(q[0].sessionId).toBe('s1')
    expect(q[1].sessionId).toBe('s2')
  })
})

describe('dequeueSegments', () => {
  it('removes the leading N entries for the given session', () => {
    enqueueSegments('s1', [seg('a'), seg('b'), seg('c')])
    dequeueSegments('s1', 2)
    const q = readQueue()
    expect(q).toHaveLength(1)
    expect(q[0].text).toBe('c')
  })

  it('does not remove entries belonging to a different session', () => {
    enqueueSegments('s1', [seg('s1-a')])
    enqueueSegments('s2', [seg('s2-a')])
    dequeueSegments('s1', 1)
    const q = readQueue()
    expect(q).toHaveLength(1)
    expect(q[0].sessionId).toBe('s2')
  })
})

// ---- postTranscript: buffer behavior ----------------------------------------

describe('postTranscript (buffer)', () => {
  it('enqueues segments and POSTs them; clears queue on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await postTranscript('s1', [seg('hello')])

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(readQueue()).toHaveLength(0)
  })

  it('retains segments in queue on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network down'))
    vi.stubGlobal('fetch', fetchMock)

    await postTranscript('s1', [seg('lost')])

    expect(readQueue()).toHaveLength(1)
    expect(readQueue()[0].text).toBe('lost')
  })

  it('retains segments in queue on non-ok response (5xx)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock)

    await postTranscript('s1', [seg('queued')])

    expect(readQueue()).toHaveLength(1)
  })

  it('calls signOut and retains queue on 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    vi.stubGlobal('fetch', fetchMock)

    await postTranscript('s1', [seg('auth-fail')])

    expect(signOut).toHaveBeenCalled()
    // Segments not lost — remain in queue for after re-auth.
    expect(readQueue()).toHaveLength(1)
  })

  it('drops the session queue on 404 (stale)', async () => {
    enqueueSegments('s1', [seg('orphan')])
    vi.stubGlobal('fetch', makeFetch(404, false))

    const result = await postTranscript('s1', [seg('stale-seg')])

    expect(result).toBe('stale')
    expect(readQueue()).toHaveLength(0)
  })
})

// ---- postTranscript: 'ok' | 'stale' return contract -------------------------

describe('postTranscript (return contract)', () => {
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

// ---- flushQueue: chunking ---------------------------------------------------

describe('flushQueue chunking', () => {
  it('sends segments in batches of at most 100', async () => {
    // 250 segments → 3 fetches: 100 + 100 + 50
    const segs = Array.from({ length: 250 }, (_, i) => seg(`seg-${i}`))
    enqueueSegments('s1', segs)

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await flushQueue('s1')

    expect(fetchMock).toHaveBeenCalledTimes(3)

    const bodies = (fetchMock.mock.calls as [string, { body: string }][]).map((c) => {
      const parsed = JSON.parse(c[1].body) as { segments: unknown[] }
      return parsed.segments.length
    })
    expect(bodies).toEqual([100, 100, 50])

    expect(readQueue()).toHaveLength(0)
  })

  it('stops sending subsequent batches after a failure', async () => {
    const segs = Array.from({ length: 150 }, (_, i) => seg(`seg-${i}`))
    enqueueSegments('s1', segs)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValueOnce(new Error('timeout'))
    vi.stubGlobal('fetch', fetchMock)

    await flushQueue('s1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // First 100 cleared; remaining 50 still queued.
    expect(readQueue()).toHaveLength(50)
  })

  it('attaches Authorization header when a token is available', async () => {
    vi.mocked(getIdToken).mockResolvedValue('test-token-xyz')

    enqueueSegments('s1', [seg('auth-test')])
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await flushQueue('s1')

    const headers = (fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }])[1].headers
    expect(headers['Authorization']).toBe('Bearer test-token-xyz')
  })

  it('omits Authorization header when no token (local dev bypass)', async () => {
    vi.mocked(getIdToken).mockResolvedValue(null)

    enqueueSegments('s1', [seg('no-auth')])
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await flushQueue('s1')

    const headers = (fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }])[1].headers
    expect(headers['Authorization']).toBeUndefined()
  })
})

// ---- postNearMisses ---------------------------------------------------------

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
