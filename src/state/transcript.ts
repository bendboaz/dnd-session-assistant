// Posts finalized transcript segments to the backend (WP-D). The backend may be
// absent during dev — every failure is swallowed and logged, never surfaced to
// the user, so the listening UX keeps working offline.

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

/** Append one or more finalized segments. No-op (logged) if the backend is absent. */
export async function postTranscript(
  sessionId: string,
  segments: TranscriptSegment[],
): Promise<void> {
  if (!segments.length) return
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
    if (!res.ok) throw new Error(`status ${res.status}`)
  } catch (err) {
    console.warn('[transcript] postTranscript failed (backend absent?)', err)
  }
}
