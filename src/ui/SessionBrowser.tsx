// Full-screen overlay listing past sessions in reverse-chronological order —
// the entry point into the browsing flow (issue #34). Fetches from
// GET /api/sessions once on open; tapping a row hands off to the transcript view.

import { useEffect, useState } from 'react'
import { fetchSessions } from '../state/sessions'
import type { SessionSummary } from '../state/sessions'

interface SessionBrowserProps {
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}

function formatStartedAt(iso: string | null): string {
  if (!iso) return 'Unknown date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function SessionBrowser({ onClose, onOpenSession }: SessionBrowserProps) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)

  useEffect(() => {
    let alive = true
    void fetchSessions().then((s) => {
      if (alive) setSessions(s)
    })
    return () => {
      alive = false
    }
  }, [])

  // Close on Escape (laptop) for convenience, matching EntryDetail's pattern.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--color-bg)]">
      <header
        className="safe-top flex items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h1 className="flex-1 text-lg font-bold text-[var(--color-ink)]">Past sessions</h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[var(--color-ink-dim)] active:scale-95"
          style={{ borderColor: 'var(--color-border)' }}
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {sessions === null && (
          <p className="px-6 py-12 text-center text-sm text-[var(--color-ink-dim)]">
            Loading…
          </p>
        )}

        {sessions !== null && sessions.length === 0 && (
          <p className="px-6 py-12 text-center text-sm text-[var(--color-ink-dim)]">
            No past sessions yet.
          </p>
        )}

        {sessions !== null && sessions.length > 0 && (
          <ul className="flex flex-col gap-2 px-3 py-3">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenSession(s.id)}
                  className="flex min-h-[56px] w-full flex-col items-start gap-1 rounded-xl border bg-[var(--color-surface)] px-4 py-3 text-left active:bg-[var(--color-surface-2)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <span className="truncate text-base font-semibold text-[var(--color-ink)]">
                    {s.title || 'Untitled session'}
                  </span>
                  <span className="text-xs text-[var(--color-ink-dim)]">
                    {formatStartedAt(s.startedAt)} · {s.segmentCount}{' '}
                    segment{s.segmentCount === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
