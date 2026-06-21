// Posts finalized transcript segments and near-miss tokens to the backend (WP-D).
// The backend may be absent during dev — every network failure is swallowed and
// logged, never surfaced to the user, so the listening UX keeps working offline.
//
// Auth: if a Firebase user is signed in, every request carries
// `Authorization: Bearer <idToken>`. On 401 the user is signed out so the
// SignInGate can prompt re-auth. With no token (local dev / DEV_AUTH_BYPASS) we
// proceed without the header — the backend decides.
//
// Resilience buffer: finalized segments are queued in localStorage before the
// POST is attempted, so a crash/reload/outage doesn't lose them; they are retried
// (in BATCH_SIZE chunks) on the next flush. A 404 means the session is stale
// server-side — we drop its queued entries and return 'stale' so the caller can
// create a fresh session and re-post the segment under the new id.
//
// Near-miss posting is gated server-side on ENABLE_DATA_COLLECTION=true. The
// client always attempts the call; the server returns 403 when collection is
// disabled, which the client silently ignores.

import type { TranscriptSegment } from '../stt/types'
import { getIdToken, signOut } from '../auth/firebase'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

// ---- localStorage buffer ----------------------------------------------------

const QUEUE_KEY = 'dnd-assistant:transcript-queue'
const BATCH_SIZE = 100 // backend cap is 1 000; 100 is a comfortable margin

/** A queued segment tagged with the session it belongs to. */
interface QueuedSegment {
  sessionId: string
  text: string
  startTime?: number
  ts: number
}

/** Read the persisted queue. Returns [] on any error (private mode, corrupt data). */
export function readQueue(): QueuedSegment[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as QueuedSegment[]
  } catch {
    return []
  }
}

/** Overwrite the persisted queue. Silently swallows errors (quota, private mode). */
function writeQueue(q: QueuedSegment[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch {
    // best-effort
  }
}

/** Enqueue segments for a given session. Called before the POST attempt. */
export function enqueueSegments(sessionId: string, segments: TranscriptSegment[]): void {
  const queue = readQueue()
  for (const s of segments) {
    queue.push({ sessionId, text: s.text, startTime: s.startTime, ts: s.ts })
  }
  writeQueue(queue)
}

/**
 * Remove exactly `count` leading entries that belong to `sessionId` from the
 * queue. Called on a successful POST to clear just the segments that were sent.
 */
export function dequeueSegments(sessionId: string, count: number): void {
  const queue = readQueue()
  let removed = 0
  const next = queue.filter((q) => {
    if (q.sessionId === sessionId && removed < count) {
      removed++
      return false
    }
    return true
  })
  writeQueue(next)
}

/**
 * Drop ALL queued entries for a session. Used when the backend reports the
 * session is stale (404): those entries can never be delivered under this id, so
 * we discard them rather than let them accumulate. The caller re-posts the live
 * segment under a fresh session id.
 */
function dropSession(sessionId: string): void {
  writeQueue(readQueue().filter((q) => q.sessionId !== sessionId))
}

// ---- auth helpers -----------------------------------------------------------

/** Build auth headers. Returns {} when no user is signed in (local dev bypass). */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Handle a 401 response: sign the user out so the SignInGate shows the sign-in
 * screen. The failing request is not retried — the next session creation / POST
 * will succeed once the user re-authenticates.
 */
function handle401(): void {
  console.warn('[transcript] 401 — signing out to prompt re-auth')
  void signOut()
}

// ---- public API -------------------------------------------------------------

/** Create a session up front; returns its id, or null if the backend is absent. */
export async function createSession(title?: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders()),
      },
      body: JSON.stringify({ title, startedAt: new Date().toISOString() }),
    })
    if (res.status === 401) {
      handle401()
      return null
    }
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = (await res.json()) as { id: string }
    return body.id
  } catch (err) {
    console.warn('[transcript] createSession failed (backend absent?)', err)
    return null
  }
}

/**
 * Append one or more finalized segments. Enqueues them in localStorage first,
 * then flushes the queue for this session.
 *
 * Returns `'stale'` when the backend responds 404 — the caller should discard the
 * persisted session ID and create a fresh one rather than dropping the segment.
 * Returns `'ok'` on success or any other non-fatal failure (the queue is kept and
 * retried on the next flush).
 */
export async function postTranscript(
  sessionId: string,
  segments: TranscriptSegment[],
): Promise<'ok' | 'stale'> {
  if (!segments.length) return 'ok'
  // Persist before the network attempt so a page crash or nav doesn't lose data.
  enqueueSegments(sessionId, segments)
  return flushQueue(sessionId)
}

/**
 * Send all queued segments for `sessionId` to the backend, in batches of at most
 * BATCH_SIZE. Called by postTranscript (and safe to call again to catch up).
 * Returns `'stale'` if the backend reports the session is gone (404), else `'ok'`.
 */
export async function flushQueue(sessionId: string): Promise<'ok' | 'stale'> {
  const queue = readQueue().filter((q) => q.sessionId === sessionId)
  if (!queue.length) return 'ok'

  const auth = await authHeaders()

  // Send in BATCH_SIZE chunks so we never exceed the backend's per-request cap.
  for (let offset = 0; offset < queue.length; offset += BATCH_SIZE) {
    const batch = queue.slice(offset, offset + BATCH_SIZE)
    try {
      const res = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth },
          body: JSON.stringify({
            segments: batch.map((s) => ({
              text: s.text,
              startTime: s.startTime,
              ts: s.ts,
            })),
          }),
        },
      )
      if (res.status === 401) {
        handle401()
        return 'ok' // queue kept intact; delivered after re-auth
      }
      if (res.status === 404) {
        // Session is stale server-side: its queued entries are undeliverable.
        dropSession(sessionId)
        return 'stale'
      }
      if (!res.ok) throw new Error(`status ${res.status}`)
      // Only clear the entries we just successfully sent.
      dequeueSegments(sessionId, batch.length)
    } catch (err) {
      console.warn('[transcript] postTranscript failed (backend absent?)', err)
      return 'ok' // leave the remaining queue intact; retry on next flush
    }
  }
  return 'ok'
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
 * so the client does not need to gate the call. All errors are swallowed.
 *
 * Privacy: `context` is a fragment of real table-audio transcript. Near-miss
 * collection is therefore opt-in on the server side. See docs/DESIGN.md §Privacy.
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
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ near_misses: nearMisses }),
      },
    )
    if (!res.ok && res.status !== 403) throw new Error(`status ${res.status}`)
  } catch (err) {
    console.warn('[transcript] postNearMisses failed (backend absent?)', err)
  }
}
