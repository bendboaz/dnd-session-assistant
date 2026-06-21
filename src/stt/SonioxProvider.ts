// Soniox real-time STT provider.
//
// Soniox natively handles Hebrew↔English code-switching, which is exactly our
// table's speech pattern (Hebrew narration with English spell/monster names) —
// it auto-detects per-token language, so an English term inside a Hebrew
// sentence stays English in the transcript and matches the English SRD directly.
//
// We stream raw PCM16 over the Soniox real-time WebSocket and authenticate with
// a short-lived temporary API key minted by our backend (never the long-lived
// key). Protocol: connect, send one JSON config frame first (temporary api_key,
// audio format, model, language hints, context terms), then stream binary PCM.
// The server replies with JSON messages containing `tokens[]`, each with
// `text`, `is_final`, and `start_ms`.
//
// Control markers (e.g. `<end>`, `<start>`, `<noise>`) appear in Soniox token
// text to signal stream events; they are not transcript content and must be
// stripped before the segment reaches the UI or the matching engine.

import { BaseWsProvider, type ProviderSpec } from './BaseWsProvider'
import type { TranscriptSegment } from './types'

const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
// Multilingual real-time model; Soniox auto-detects per-token language.
const SONIOX_MODEL = 'stt-rt-preview'
// Defensive cap on context terms to keep the config frame small. Keyterms are a
// targeted booster (pinned + expected names), not full coverage — the local
// matching engine handles the rest.
const SONIOX_KEYTERM_CAP = 100

// Soniox embeds control markers in token text to signal stream boundaries.
// These are not transcript content and must never reach the UI or matcher.
const SONIOX_CONTROL_MARKER_RE = /<(end|start|noise)>/g

interface SonioxToken {
  text: string
  is_final?: boolean
  start_ms?: number
}

interface SonioxMessage {
  tokens?: SonioxToken[]
  error_code?: number
  error_message?: string
}

/**
 * Build the Soniox opening config frame. Exported so tests can assert its shape
 * without standing up a real WebSocket connection.
 */
export function buildSonioxOpeningFrame(
  token: string,
  keyterms: string[],
): Record<string, unknown> {
  return {
    api_key: token,
    model: SONIOX_MODEL,
    audio_format: 'pcm_s16le',
    sample_rate: 16_000,
    num_channels: 1,
    language_hints: ['he', 'en'],
    enable_endpoint_detection: true,
    ...(keyterms.length ? { context: { terms: keyterms } } : {}),
  }
}

export class SonioxProvider extends BaseWsProvider {
  constructor() {
    const spec: ProviderSpec = {
      name: 'soniox',

      // Soniox authenticates inside the opening config frame, not the URL.
      socketUrl: () => SONIOX_WS_URL,

      openingMessages: (token, keyterms) =>
        [JSON.stringify(buildSonioxOpeningFrame(token, keyterms))],

      clampKeyterms: (terms) => dedupeClamp(terms, SONIOX_KEYTERM_CAP),

      parseMessage: (data) => parseSonioxMessage(data),

      // A periodic empty PCM frame keeps intermediary proxies from idling out
      // the socket during quiet stretches at the table.
      keepAliveMessage: () => new ArrayBuffer(0),

      // Empty binary frame signals end-of-audio so the server finalizes.
      closeMessage: () => new ArrayBuffer(0),
    }
    super(spec)
  }
}

/** Exported for unit-testing only — tests import this directly. */
export function dedupeClamp(terms: string[], cap: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of terms) {
    const v = t.trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
    if (out.length >= cap) break
  }
  return out
}

function stripControlMarkers(text: string): string {
  return text.replace(SONIOX_CONTROL_MARKER_RE, '')
}

/** Join token texts, stripping Soniox control markers before trimming. */
function toText(tokens: SonioxToken[]): string {
  return tokens
    .map((t) => stripControlMarkers(t.text))
    .join('')
    .trim()
}

/** Exported for unit-testing only. */
export function parseSonioxMessage(data: string): TranscriptSegment[] {
  const msg = JSON.parse(data) as SonioxMessage
  if (msg.error_code) {
    throw new Error(`Soniox error ${msg.error_code}: ${msg.error_message ?? 'unknown'}`)
  }
  const tokens = msg.tokens ?? []
  if (tokens.length === 0) return []

  const ts = Date.now()
  // Soniox interleaves final + interim tokens in one message; split them so
  // finals are emitted as a final segment and the rest as interim.
  const finalTokens = tokens.filter((t) => t.is_final)
  const interimTokens = tokens.filter((t) => !t.is_final)
  const startMs = tokens.find((t) => typeof t.start_ms === 'number')?.start_ms
  const startTime = startMs !== undefined ? startMs / 1000 : undefined

  const segments: TranscriptSegment[] = []
  if (finalTokens.length) {
    segments.push({ text: toText(finalTokens), isFinal: true, startTime, ts })
  }
  if (interimTokens.length) {
    segments.push({ text: toText(interimTokens), isFinal: false, startTime, ts })
  }
  return segments.filter((s) => s.text.length > 0)
}
