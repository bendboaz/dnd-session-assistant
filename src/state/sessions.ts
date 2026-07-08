// API client for the past-session browsing flow (issue #34): listing sessions
// and fetching a session's full transcript. Both are plain read-only GETs — no
// localStorage buffering like transcript.ts's POST queue, since there's nothing
// to retry-on-failure; a failed fetch just leaves the browsing UI empty/erroring.
//
// Auth follows the same pattern as transcript.ts: a Bearer token is attached
// when a Firebase user is signed in, and a 401 signs the user out so the
// SignInGate can prompt re-auth.

import { authHeaders, handle401 } from './transcript'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

/** Matches the backend's `SessionSummary` model. */
export interface SessionSummary {
  id: string
  title: string | null
  startedAt: string | null
  segmentCount: number
}

/** Matches the backend's `TranscriptSegmentResponse` model. */
export interface StoredSegment {
  text: string
  startTime?: number
  ts: number
}

/**
 * List all past sessions, newest first (server-sorted).
 *
 * Returns `'error'` for a genuine failure (network error, non-2xx, bad JSON) so
 * the UI can tell "couldn't load" apart from "loaded, no sessions yet". A 401
 * still resolves to `[]`: handle401() signs the user out, and SignInGate takes
 * over almost immediately, so there's no meaningful "error" state to show for it.
 */
export async function fetchSessions(): Promise<SessionSummary[] | 'error'> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      headers: { ...(await authHeaders()) },
    })
    if (res.status === 401) {
      handle401() // deliberately [] not 'error' here — see the doc comment above
      return []
    }
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = (await res.json()) as { sessions: SessionSummary[] }
    return body.sessions
  } catch (err) {
    console.warn('[sessions] fetchSessions failed (backend absent?)', err)
    return 'error'
  }
}

/**
 * Fetch every transcript segment for a session, in timestamp order. Same
 * 'error'-vs-[] distinction as fetchSessions above, and the same rationale.
 */
export async function fetchTranscript(
  sessionId: string,
): Promise<StoredSegment[] | 'error'> {
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript`,
      { headers: { ...(await authHeaders()) } },
    )
    if (res.status === 401) {
      handle401() // deliberately [] not 'error' here — see fetchSessions' doc comment
      return []
    }
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = (await res.json()) as { segments: StoredSegment[] }
    return body.segments
  } catch (err) {
    console.warn('[sessions] fetchTranscript failed (backend absent?)', err)
    return 'error'
  }
}
