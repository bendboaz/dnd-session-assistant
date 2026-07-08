// Shared date display formatting for the session-browsing views
// (SessionBrowser, TranscriptView).

/** Formats an ISO-8601 timestamp for display, falling back on null/invalid input. */
export function formatStartedAt(iso: string | null): string {
  if (!iso) return 'Unknown date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
