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
 * List all past sessions, newest first (server-sorted). Returns [] on any
 * failure (backend absent, network error, non-2xx) — the browser UI treats
 * that the same as "no sessions yet" rather than surfacing an error state.
 */
export async function fetchSessions(): Promise<SessionSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      headers: { ...(await authHeaders()) },
    })
    if (res.status === 401) {
      handle401()
      return []
    }
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = (await res.json()) as { sessions: SessionSummary[] }
    return body.sessions
  } catch (err) {
    console.warn('[sessions] fetchSessions failed (backend absent?)', err)
    return []
  }
}

/**
 * Fetch every transcript segment for a session, in timestamp order. Returns []
 * on any failure, same rationale as fetchSessions above.
 */
export async function fetchTranscript(sessionId: string): Promise<StoredSegment[]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript`,
      { headers: { ...(await authHeaders()) } },
    )
    if (res.status === 401) {
      handle401()
      return []
    }
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = (await res.json()) as { segments: StoredSegment[] }
    return body.segments
  } catch (err) {
    console.warn('[sessions] fetchTranscript failed (backend absent?)', err)
    return []
  }
}
