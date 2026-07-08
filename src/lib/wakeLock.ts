// Thin wrapper around the Screen Wake Lock API (navigator.wakeLock).
//
// Keeps the screen on while actively listening at the table. Support is
// Chrome/Android-only today (the PWA's primary target per the manifest);
// Safari/iOS has no `navigator.wakeLock` at all. Every function here is a
// silent no-op when the API is unsupported or a request/release fails (e.g.
// browser denies the request because the tab isn't visible) — this is a
// nice-to-have, never worth crashing or warning the user over.

let sentinel: WakeLockSentinel | null = null

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

/**
 * Request a screen wake lock. No-op (resolves silently) if the API is
 * unsupported or the request is rejected (e.g. document not visible).
 */
export async function acquireWakeLock(): Promise<void> {
  if (!isSupported()) return
  try {
    sentinel = await navigator.wakeLock.request('screen')
  } catch {
    // Best-effort: denied (e.g. backgrounded tab) or transiently unsupported.
    sentinel = null
  }
}

/**
 * Release the held wake lock, if any. Safe to call even if no lock is held
 * or the API is unsupported.
 */
export async function releaseWakeLock(): Promise<void> {
  const current = sentinel
  sentinel = null
  if (!current) return
  try {
    await current.release()
  } catch {
    // Best-effort: already released or the browser dropped it.
  }
}

/** Whether a wake lock is currently believed to be held. */
export function hasWakeLock(): boolean {
  return sentinel !== null && !sentinel.released
}
