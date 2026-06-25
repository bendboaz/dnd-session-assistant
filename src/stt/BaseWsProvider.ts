// Shared machinery for the real WebSocket-based providers (Soniox, Deepgram).
//
// It owns the lifecycle that both providers share verbatim:
//   • fetching a short-lived token from the backend (and refreshing it before a
//     long, hours-long session lets it expire),
//   • opening the mic + WebSocket and pumping PCM frames,
//   • auto-reconnect with exponential backoff + jitter,
//   • a keepalive ping so idle stretches don't drop the socket,
//   • accurate SttState transitions via onStateChange.
//
// Subclasses only describe provider specifics: the WebSocket URL (given a
// token), how to encode the per-stream config, how to parse provider messages
// into TranscriptSegments, and how keyterms map onto the provider's feature.

import type {
  SttCallbacks,
  SttProvider,
  SttProviderName,
  SttState,
  SttTokenResponse,
  TranscriptSegment,
} from './types'
import { startMic, type MicCapture, MIC_SAMPLE_RATE } from './mic'
import { getIdToken, signOut } from '../auth/firebase'
import { debugLog } from '../lib/logger'

/** What a concrete provider must supply to the shared lifecycle. */
export interface ProviderSpec {
  readonly name: SttProviderName
  /** Build the streaming WebSocket URL for a freshly minted token. */
  socketUrl(token: string, sampleRate: number): string
  /**
   * Subprotocols to pass to `new WebSocket(url, protocols)`, if the provider
   * authenticates the token that way (Deepgram does: `['token', <token>]`).
   * Return `undefined` when the token is carried in the URL (Soniox).
   */
  socketProtocols?(token: string): string[] | undefined
  /**
   * First message(s) to send once the socket opens — typically a JSON config
   * frame declaring language/encoding/keyterms. Receives the live token because
   * some providers (Soniox) authenticate in the opening body rather than the
   * URL/subprotocol. Return `undefined` to send nothing (config carried in the
   * URL). Strings are sent as text frames.
   */
  openingMessages?(token: string, keyterms: string[]): Array<string | ArrayBuffer> | undefined
  /** Parse one provider message into zero or more transcript segments. */
  parseMessage(data: string): TranscriptSegment[]
  /** Truncate/format keyterms to the provider's cap; used by openingMessages. */
  clampKeyterms(terms: string[]): string[]
  /** Optional keepalive frame; if omitted, a WebSocket ping is not sent. */
  keepAliveMessage?(): string | ArrayBuffer | undefined
  /** Optional graceful-finalize frame sent on stop() before close. */
  closeMessage?(): string | ArrayBuffer | undefined
}

/** Resolve the backend base URL (empty string → same-origin / dev proxy). */
function apiBase(): string {
  return import.meta.env.VITE_API_BASE ?? ''
}

const KEEPALIVE_MS = 8_000
const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 500
// Refresh the token this many seconds before it expires (or at half-life,
// whichever is sooner) so a reconnect always has a valid credential.
const TOKEN_REFRESH_LEAD_S = 30

export abstract class BaseWsProvider implements SttProvider {
  readonly name: SttProviderName

  private readonly spec: ProviderSpec
  private state: SttState = 'idle'
  private callbacks: SttCallbacks | null = null

  private ws: WebSocket | null = null
  private mic: MicCapture | null = null
  private keyterms: string[] = []

  // Token cache + scheduled refresh.
  private token: string | null = null
  private tokenExpiresAt = 0 // epoch ms
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  private keepAliveTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0

  // `running` reflects user intent (start() called, stop() not yet). It gates
  // whether a socket close should trigger a reconnect.
  private running = false

  constructor(spec: ProviderSpec) {
    this.spec = spec
    this.name = spec.name
  }

  getState(): SttState {
    return this.state
  }

  setKeyterms(terms: string[]): void {
    this.keyterms = this.spec.clampKeyterms(terms)
    // Most providers only accept keyterms at stream open. We apply the new set
    // on the next (re)connect rather than tearing down a live stream.
    debugLog('stt:keyterms', { provider: this.name, count: this.keyterms.length, terms: this.keyterms })
  }

  async start(callbacks: SttCallbacks): Promise<void> {
    if (this.running) return
    this.callbacks = callbacks
    this.running = true
    this.reconnectAttempts = 0

    this.setState('connecting')
    try {
      this.mic = await startMic({ onFrame: (pcm) => this.sendAudio(pcm) })
    } catch (err) {
      this.running = false
      this.fail(err, 'mic')
      return
    }

    await this.connect()
  }

  async stop(): Promise<void> {
    this.running = false
    this.clearTimers()

    const closeMsg = this.spec.closeMessage?.()
    if (closeMsg && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(closeMsg)
      } catch {
        // ignore — we're tearing down anyway
      }
    }
    this.teardownSocket()

    this.mic?.stop()
    this.mic = null

    this.setState('stopped')
  }

  // --- token handling -------------------------------------------------------

  private async ensureToken(): Promise<string> {
    const now = Date.now()
    if (this.token && now < this.tokenExpiresAt - TOKEN_REFRESH_LEAD_S * 1000) {
      return this.token
    }
    // Attach the Firebase ID token when signed in; omit it in local dev so
    // DEV_AUTH_BYPASS on the backend still works without a real user session.
    const idToken = await getIdToken()
    const authHeader: Record<string, string> = idToken
      ? { Authorization: `Bearer ${idToken}` }
      : {}
    const res = await fetch(`${apiBase()}/api/stt-token?provider=${this.name}`, {
      headers: { Accept: 'application/json', ...authHeader },
    })
    if (res.status === 401) {
      // Session expired mid-stream — sign out so the SignInGate prompts re-auth.
      console.warn('[stt] stt-token returned 401 — signing out to prompt re-auth')
      void signOut()
      throw new Error('stt-token: 401 Unauthorized')
    }
    if (!res.ok) {
      throw new Error(`stt-token request failed: ${res.status} ${res.statusText}`)
    }
    const body = (await res.json()) as SttTokenResponse
    if (!body.token) throw new Error('stt-token response had no token')
    this.token = body.token
    this.tokenExpiresAt = Date.now() + Math.max(0, body.expiresIn) * 1000
    this.scheduleTokenRefresh(body.expiresIn)
    return this.token
  }

  /**
   * Schedule a proactive reconnect a bit before the token expires. A long D&D
   * session can outlive a single short-lived token, so we cycle the stream onto
   * a fresh credential rather than letting the provider drop us.
   */
  private scheduleTokenRefresh(expiresInS: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    const leadS = Math.min(TOKEN_REFRESH_LEAD_S, expiresInS / 2)
    const delayMs = Math.max(1_000, (expiresInS - leadS) * 1000)
    this.refreshTimer = setTimeout(() => {
      if (!this.running) return
      // Force a token re-mint, then reconnect onto it.
      this.token = null
      this.reconnect(true)
    }, delayMs)
  }

  // --- connection lifecycle -------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.running) return
    let token: string
    try {
      token = await this.ensureToken()
    } catch (err) {
      // Token mint failed — treat as a transient fault and back off.
      this.scheduleReconnect(err)
      return
    }
    if (!this.running) return

    const url = this.spec.socketUrl(token, MIC_SAMPLE_RATE)
    const protocols = this.spec.socketProtocols?.(token)

    let ws: WebSocket
    try {
      ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url)
    } catch (err) {
      this.scheduleReconnect(err)
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      if (!this.running || this.ws !== ws) {
        ws.close()
        return
      }
      this.reconnectAttempts = 0
      const opening = this.spec.openingMessages?.(token, this.keyterms)
      if (opening) for (const m of opening) ws.send(m)
      this.startKeepAlive()
      this.setState('listening')
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return // providers send JSON text frames
      let segments: TranscriptSegment[]
      try {
        segments = this.spec.parseMessage(ev.data)
      } catch {
        return // ignore unparseable control frames
      }
      for (const seg of segments) {
        debugLog('stt:segment', {
          provider: this.name,
          text: seg.text,
          isFinal: seg.isFinal,
          startTime: seg.startTime,
          ts: seg.ts,
        })
        this.callbacks?.onSegment(seg)
      }
    }

    ws.onerror = () => {
      // The browser fires a generic Event; the following onclose carries the
      // actionable info and drives reconnect.
    }

    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null
      this.stopKeepAlive()
      if (!this.running) return
      this.scheduleReconnect(
        new Error(`stream closed (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''})`),
      )
    }
  }

  /** Tear down the current socket and immediately attempt a new connection. */
  private reconnect(immediate: boolean): void {
    this.teardownSocket()
    if (immediate) {
      this.setState('reconnecting')
      void this.connect()
    } else {
      this.scheduleReconnect(new Error('reconnect requested'))
    }
  }

  private scheduleReconnect(err: unknown): void {
    if (!this.running) return
    // Surface the cause but keep trying — hours-long sessions must self-heal.
    this.callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)))
    this.setState('reconnecting')

    const attempt = this.reconnectAttempts++
    const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
    const jitter = Math.random() * backoff * 0.3
    const delay = backoff + jitter

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      if (this.running) void this.connect()
    }, delay)
  }

  private sendAudio(pcm: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm)
    }
    // If the socket is mid-reconnect we drop frames rather than buffer
    // unboundedly; a couple hundred ms of audio gap is acceptable for lookups.
  }

  // --- keepalive ------------------------------------------------------------

  private startKeepAlive(): void {
    const msg = this.spec.keepAliveMessage?.()
    if (msg === undefined) return
    this.stopKeepAlive()
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(msg)
        } catch {
          // socket dying; onclose will handle reconnect
        }
      }
    }, KEEPALIVE_MS)
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
  }

  // --- helpers --------------------------------------------------------------

  private teardownSocket(): void {
    this.stopKeepAlive()
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
    } catch {
      // ignore
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.stopKeepAlive()
  }

  private fail(err: unknown, _kind: 'mic' | 'token' | 'socket'): void {
    this.clearTimers()
    this.teardownSocket()
    this.mic?.stop()
    this.mic = null
    this.callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)))
    this.setState('error')
  }

  private setState(next: SttState): void {
    if (this.state === next) return
    this.state = next
    this.callbacks?.onStateChange?.(next)
  }
}
