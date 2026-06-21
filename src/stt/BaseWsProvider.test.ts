// Integration-style tests for BaseWsProvider reconnect/backoff logic.
//
// Two scenarios:
//   1. Happy path — provider connects, receives a segment, stops cleanly.
//   2. One-drop — socket closes mid-session; provider transitions to
//      `reconnecting` and then back to `listening` on the next connection.
//
// All browser APIs (WebSocket, fetch, startMic) are stubbed so these tests
// run in the jsdom/node environment without a real mic or network.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SonioxProvider } from './SonioxProvider'
import type { SttState, TranscriptSegment } from './types'

// ---------------------------------------------------------------------------
// Stub the mic module — the real startMic needs AudioContext/getUserMedia.
// ---------------------------------------------------------------------------

vi.mock('./mic', () => ({
  MIC_SAMPLE_RATE: 16_000,
  MIC_CHANNELS: 1,
  startMic: vi.fn().mockResolvedValue({
    sampleRate: 16_000,
    channels: 1,
    stop: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Minimal WebSocket stub.
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  readyState: number = MockWebSocket.OPEN
  binaryType: string = 'arraybuffer'
  url: string
  protocols: string[] | undefined

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

  constructor(url: string, protocols?: string[]) {
    this.url = url
    this.protocols = protocols
    lastWs = this
    wsInstances.push(this)
  }

  /** Simulate the server accepting the connection. */
  triggerOpen(): void {
    this.onopen?.()
  }

  /** Push a transcript message from the server. */
  triggerMessage(data: string): void {
    this.onmessage?.({ data })
  }

  /** Simulate the server dropping the connection. */
  triggerClose(code = 1006, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

let lastWs: MockWebSocket | null = null
const wsInstances: MockWebSocket[] = []

// ---------------------------------------------------------------------------
// Stub fetch (for /api/stt-token).
// ---------------------------------------------------------------------------

function stubToken(token = 'fake-token', expiresIn = 3600): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ provider: 'soniox', token, expiresIn }),
  } as Response)
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  wsInstances.length = 0
  lastWs = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket
  stubToken()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RunResult {
  states: SttState[]
  segments: TranscriptSegment[]
  errors: Error[]
  provider: SonioxProvider
}

async function startProvider(): Promise<RunResult> {
  const provider = new SonioxProvider()
  const states: SttState[] = []
  const segments: TranscriptSegment[] = []
  const errors: Error[] = []

  provider.start({
    onSegment: (s) => segments.push(s),
    onStateChange: (st) => states.push(st),
    onError: (e) => errors.push(e),
  })

  // Advance just enough for the mic + token fetch + WebSocket creation to run.
  // We do NOT use runAllTimersAsync() because the token-refresh and keepalive
  // timers are long-running and would cause an "infinite loop" abort.
  await vi.advanceTimersByTimeAsync(1000)

  return { states, segments, errors, provider }
}

/** A minimal Soniox-shaped JSON message with one final token. */
function sonioxMessage(text: string, isFinal = true): string {
  return JSON.stringify({ tokens: [{ text, is_final: isFinal }] })
}

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe('BaseWsProvider — happy path', () => {
  it('transitions idle → connecting → listening', async () => {
    const { states } = await startProvider()
    lastWs!.triggerOpen()
    await vi.advanceTimersByTimeAsync(1000)

    expect(states).toContain('connecting')
    expect(states).toContain('listening')
  })

  it('delivers a segment received after open', async () => {
    const { segments } = await startProvider()
    lastWs!.triggerOpen()
    lastWs!.triggerMessage(sonioxMessage('הקוסם מטיל fireball'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(segments.length).toBeGreaterThan(0)
    expect(segments[0].text).toBe('הקוסם מטיל fireball')
    expect(segments[0].isFinal).toBe(true)
  })

  it('stops cleanly: final state is stopped', async () => {
    const { states, provider } = await startProvider()
    lastWs!.triggerOpen()
    await vi.advanceTimersByTimeAsync(1000)

    await provider.stop()
    expect(states[states.length - 1]).toBe('stopped')
  })

  it('does not emit segments after stop()', async () => {
    const { segments, provider } = await startProvider()
    lastWs!.triggerOpen()
    await provider.stop()

    // Triggering a message after stop should be ignored.
    lastWs?.triggerMessage(sonioxMessage('should not arrive'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(segments).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. One-drop reconnect
// ---------------------------------------------------------------------------

describe('BaseWsProvider — one-drop reconnect', () => {
  it('transitions to reconnecting when the socket drops', async () => {
    const { states } = await startProvider()
    lastWs!.triggerOpen()
    await vi.advanceTimersByTimeAsync(1000)

    lastWs!.triggerClose(1006, 'network error')
    await vi.advanceTimersByTimeAsync(1000)

    expect(states).toContain('reconnecting')
  })

  it('reconnects back to listening after a drop', async () => {
    const { states } = await startProvider()
    const firstWs = lastWs!
    firstWs.triggerOpen()
    await vi.advanceTimersByTimeAsync(200)

    firstWs.triggerClose(1006, 'dropped')
    // Advance past the initial backoff (BASE_BACKOFF_MS=500 + up to 30% jitter).
    await vi.advanceTimersByTimeAsync(1000)

    // A second WebSocket should have been created.
    expect(wsInstances.length).toBeGreaterThanOrEqual(2)
    const secondWs = lastWs!
    secondWs.triggerOpen()
    await vi.advanceTimersByTimeAsync(200)

    expect(states).toContain('listening')
    // The last listening state comes after reconnecting.
    const reconnectingIdx = states.lastIndexOf('reconnecting')
    const listeningIdx = states.lastIndexOf('listening')
    expect(listeningIdx).toBeGreaterThan(reconnectingIdx)
  })

  it('delivers segments after reconnect', async () => {
    const { segments } = await startProvider()
    const firstWs = lastWs!
    firstWs.triggerOpen()
    firstWs.triggerMessage(sonioxMessage('before drop'))
    firstWs.triggerClose(1006, 'dropped')
    // Advance past the initial backoff (BASE_BACKOFF_MS=500 + up to 30% jitter).
    await vi.advanceTimersByTimeAsync(1000)

    const secondWs = lastWs!
    secondWs.triggerOpen()
    secondWs.triggerMessage(sonioxMessage('after reconnect'))
    await vi.advanceTimersByTimeAsync(200)

    const texts = segments.map((s) => s.text)
    expect(texts).toContain('before drop')
    expect(texts).toContain('after reconnect')
  })
})
