// Posts finalized transcript segments to the backend (WP-D). The backend may be
// absent during dev — every network failure is swallowed and logged, never
// surfaced to the user, so the listening UX keeps working offline.
//
// Auth: if a Firebase user is signed in, every request carries
// `Authorization: Bearer <idToken>`. If the backend returns 401, the user is
// signed out so the SignInGate can prompt re-auth. When no token is available
// (local dev with DEV_AUTH_BYPASS=true) we proceed without the header — the
// backend decides.
//
// Resilience buffer: finalized segments are queued in localStorage before the
// POST is attempted. On success the sent entries are removed; on failure they
// remain queued and are retried on the next flush. Segments captured during an
// outage survive page reloads. Batches are capped at BATCH_SIZE per request so
// we stay well under the backend's 1 000-segment limit.

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
 * then attempts a POST. On success the sent entries are cleared. On failure
 * (any network/backend error) they remain queued for the next retry.
 * Batches are capped at BATCH_SIZE per request.
 */
export async function postTranscript(
  sessionId: string,
  segments: TranscriptSegment[],
): Promise<void> {
  if (!segments.length) return

  // Persist before the network attempt so a page crash or nav doesn't lose data.
  enqueueSegments(sessionId, segments)

  await flushQueue(sessionId)
}

/**
 * Send all queued segments for `sessionId` to the backend, in batches of at
 * most BATCH_SIZE. Called automatically by postTranscript; may also be called
 * on reconnect to catch up on any segments buffered during an outage.
 */
export async function flushQueue(sessionId: string): Promise<void> {
  const queue = readQueue().filter((q) => q.sessionId === sessionId)
  if (!queue.length) return

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
        return // abort flush; queue remains intact for after re-auth
      }
      if (!res.ok) throw new Error(`status ${res.status}`)
      // Only clear the entries we just successfully sent.
      dequeueSegments(sessionId, batch.length)
    } catch (err) {
      console.warn('[transcript] postTranscript failed (backend absent?)', err)
      // Leave the remaining queue intact; retry on next flush.
      return
    }
  }
}
