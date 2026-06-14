// Deepgram real-time STT provider (Nova-3 Hebrew, monolingual `language=he`).
//
// Unlike Soniox, Deepgram's Hebrew model is monolingual; English game terms are
// recovered via *keyterm prompting* (`keyterm=` query params), which is capped
// (~100 keyterms / ~500 tokens). Keyterms are therefore a targeted booster
// (pinned + expected names) — full coverage is the local matching engine.
//
// Auth: Deepgram accepts a short-lived token via the WebSocket subprotocol pair
// `['token', <token>]` (minted server-side from the scoped keys-grant API);
// never the long-lived key. Config travels in the URL query string. We stream
// raw PCM16 (linear16) and parse `Results` messages.

import { BaseWsProvider, type ProviderSpec } from './BaseWsProvider'
import type { TranscriptSegment } from './types'

const DEEPGRAM_WS_BASE = 'wss://api.deepgram.com/v1/listen'
const DEEPGRAM_MODEL = 'nova-3'
// Deepgram's keyterm prompting is capped; ~100 terms is the practical ceiling.
const DEEPGRAM_KEYTERM_CAP = 100

interface DeepgramAlternative {
  transcript?: string
}

interface DeepgramResults {
  type?: string
  is_final?: boolean
  start?: number // seconds from stream start
  channel?: { alternatives?: DeepgramAlternative[] }
}

export class DeepgramProvider extends BaseWsProvider {
  constructor() {
    const spec: ProviderSpec = {
      name: 'deepgram',

      socketUrl: (_token, sampleRate) => buildDeepgramUrl(sampleRate, currentKeyterms),

      // Deepgram authenticates the WS via the `token` subprotocol.
      socketProtocols: (token) => ['token', token],

      // Keyterms are in the URL, so capture them at clamp time for socketUrl.
      clampKeyterms: (terms) => {
        currentKeyterms = dedupeClamp(terms, DEEPGRAM_KEYTERM_CAP)
        return currentKeyterms
      },

      parseMessage: (data) => parseDeepgramMessage(data),

      // Deepgram drops idle sockets after ~10s without audio; a KeepAlive JSON
      // text frame holds the connection open during quiet table moments.
      keepAliveMessage: () => JSON.stringify({ type: 'KeepAlive' }),

      // CloseStream flushes any buffered audio and finalizes before close.
      closeMessage: () => JSON.stringify({ type: 'CloseStream' }),
    }
    super(spec)
  }
}

// Keyterms live in the connection URL, so the latest clamped set is stashed here
// for socketUrl() (which has no access to instance state). One provider instance
// drives one stream at a time, so module scope is safe.
let currentKeyterms: string[] = []

function buildDeepgramUrl(sampleRate: number, keyterms: string[]): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: 'he', // monolingual Hebrew model
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
  })
  // keyterm is repeatable; each pinned/expected term boosts its recognition.
  for (const term of keyterms) params.append('keyterm', term)
  return `${DEEPGRAM_WS_BASE}?${params.toString()}`
}

function dedupeClamp(terms: string[], cap: number): string[] {
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

function parseDeepgramMessage(data: string): TranscriptSegment[] {
  const msg = JSON.parse(data) as DeepgramResults
  // Ignore Metadata / SpeechStarted / UtteranceEnd control frames.
  if (msg.type && msg.type !== 'Results') return []
  const transcript = msg.channel?.alternatives?.[0]?.transcript ?? ''
  if (!transcript.trim()) return []
  return [
    {
      text: transcript.trim(),
      isFinal: Boolean(msg.is_final),
      startTime: typeof msg.start === 'number' ? msg.start : undefined,
      ts: Date.now(),
    },
  ]
}
