// CONTRACT FILE — shared between the STT layer and the UI.
// Owned by the orchestrator. Treat as read-only in work packages.

export type SttProviderName = 'soniox' | 'deepgram'

export type SttState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'reconnecting'
  | 'stopped'
  | 'error'

export interface TranscriptSegment {
  /** Recognized text for this segment (Hebrew with embedded English terms). */
  text: string
  /** True once the provider considers the segment final (vs. interim). */
  isFinal: boolean
  /** Seconds from stream start, if the provider supplies timing. */
  startTime?: number
  /** Epoch milliseconds when received. */
  ts: number
}

export interface SttCallbacks {
  onSegment: (seg: TranscriptSegment) => void
  onStateChange?: (state: SttState) => void
  onError?: (err: Error) => void
}

export interface SttProvider {
  readonly name: SttProviderName
  /** Begin capturing the mic and streaming to the provider. */
  start(callbacks: SttCallbacks): Promise<void>
  /** Stop streaming and release the mic. */
  stop(): Promise<void>
  /**
   * Seed/refresh recognition keyterms (pinned + expected names). Implementations
   * must respect provider limits (e.g. Deepgram ~100 words) and may ignore extras.
   */
  setKeyterms(terms: string[]): void
  getState(): SttState
}

/** Shape returned by the backend's GET /api/stt-token?provider= endpoint. */
export interface SttTokenResponse {
  provider: SttProviderName
  /** Short-lived token used to authenticate the streaming WebSocket. */
  token: string
  /** Seconds until the token expires. */
  expiresIn: number
}
