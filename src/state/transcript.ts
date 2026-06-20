// Posts finalized transcript segments and near-miss tokens to the backend (WP-D).
// The backend may be absent during dev — every failure is swallowed and logged,
// never surfaced to the user, so the listening UX keeps working offline.
//
// Near-miss posting is gated server-side on ENABLE_DATA_COLLECTION=true.  The
// client always attempts the call; the server returns 403 if data collection is
// disabled, which the client silently ignores.

import type { TranscriptSegment } from '../stt/types'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

/** Create a session up front; returns its id, or null if the backend is absent. */
export async function createSession(title?: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, startedAt: new Date().toISOString() }),
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = (await res.json()) as { id: string }
    return body.id
  } catch (err) {
    console.warn('[transcript] createSession failed (backend absent?)', err)
    return null
  }
}

/**
 * Append one or more finalized segments. No-op (logged) if the backend is absent.
 *
 * Returns `'stale'` when the backend responds 404 — the caller should discard the
 * persisted session ID and create a fresh one rather than dropping the segment.
 * Returns `'ok'` on success or any other non-fatal failure.
 */
export async function postTranscript(
  sessionId: string,
  segments: TranscriptSegment[],
): Promise<'ok' | 'stale'> {
  if (!segments.length) return 'ok'
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          segments: segments.map((s) => ({
            text: s.text,
            startTime: s.startTime,
            ts: s.ts,
          })),
        }),
      },
    )
    if (res.status === 404) return 'stale'
    if (!res.ok) throw new Error(`status ${res.status}`)
    return 'ok'
  } catch (err) {
    console.warn('[transcript] postTranscript failed (backend absent?)', err)
    return 'ok'
  }
}

export interface NearMissPayload {
  token: string
  context: string
  ts: number
}

/**
 * Post near-miss tokens to the backend for production data collection.
 *
 * The server silently rejects this with 403 when ENABLE_DATA_COLLECTION is off,
 * so the client does not need to gate the call.  All errors are swallowed.
 *
 * Privacy: `context` is a fragment of real table-audio transcript.  Near-miss
 * collection is therefore opt-in on the server side.  See docs/DESIGN.md §Privacy.
 */
export async function postNearMisses(
  sessionId: string,
  nearMisses: NearMissPayload[],
): Promise<void> {
  if (!nearMisses.length) return
  try {
    // 403 is expected when data collection is disabled — don't warn.
    const res = await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/near-misses`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ near_misses: nearMisses }),
      },
    )
    if (!res.ok && res.status !== 403) throw new Error(`status ${res.status}`)
  } catch (err) {
    console.warn('[transcript] postNearMisses failed (backend absent?)', err)
  }
}
