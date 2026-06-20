// Debug logger — zero overhead when disabled.
//
// Toggle with VITE_DEBUG=true in .env (or locally in the browser console via
// window.__DND_DEBUG = true). Logs are structured JSON lines to the console so
// they are easy to grep in DevTools or pipe through jq.
//
// Usage:
//   debugLog('stt:segment', { text: '...', isFinal: true, provider: 'soniox' })
//   debugLog('scan:miss', { token: 'firebolt', reason: 'no-alias-yet' })
//
// Privacy note: debug logs include raw transcript text (real table-audio content).
// They are emitted only when VITE_DEBUG=true, which must be set deliberately and
// is OFF in every production build. See docs/DESIGN.md §Privacy for the full policy.

// Build-time flag only — the runtime escape hatch (__DND_DEBUG) is handled in
// isDebugEnabled() below so toggling in the console takes effect immediately.
const DEBUG_ENABLED: boolean = import.meta.env.VITE_DEBUG === 'true'

export function isDebugEnabled(): boolean {
  // Check the runtime escape hatch on every call so toggling in the console
  // takes effect immediately without reloading.
  return (
    DEBUG_ENABLED ||
    (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__DND_DEBUG === true)
  )
}

/**
 * Emit a structured debug log entry. No-op (with no overhead) when debug is off.
 *
 * @param event  Dotted namespace string, e.g. "stt:segment", "scan:miss"
 * @param payload  Arbitrary serializable data; will be JSON-stringified inline
 */
export function debugLog(event: string, payload: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  console.debug(JSON.stringify({ t: Date.now(), event, ...payload }))
}
