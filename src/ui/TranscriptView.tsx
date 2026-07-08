// Full-screen overlay showing one past session's transcript (issue #34).
// Detections are not persisted server-side, so we re-run the matching scanner
// over each stored segment to recover them, then overlay inline highlights
// that open the same stat-block sheet as live detections.
//
// z-[45]: above SessionBrowser (z-40), below EntryDetail (z-50) — see the
// comment on each for why that order matters.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Compendium } from '../compendium/loader'
import type { CompendiumEntry } from '../compendium/types'
import { createScanner } from '../matching'
import { fetchTranscript } from '../state/sessions'
import type { SessionSummary } from '../state/sessions'
import { formatStartedAt } from './formatDate'
import { kindMeta } from './kind'
import { locateDetections } from './transcriptHighlight'
import type { HighlightRange } from './transcriptHighlight'

interface TranscriptViewProps {
  session: SessionSummary
  compendium: Compendium
  onClose: () => void
  onSelectEntry: (entry: CompendiumEntry) => void
}

interface RenderedSegment {
  key: string
  text: string
  ranges: HighlightRange[]
}

export function TranscriptView({
  session,
  compendium,
  onClose,
  onSelectEntry,
}: TranscriptViewProps) {
  // A scanner scoped to this view: fresh cooldown state per session opened, so
  // browsing one past session can't suppress detections in another. Scanning
  // segments in their stored chronological order with each segment's real `ts`
  // reproduces the same cooldown behavior the live scan would have applied.
  // `scanner` already changes identity whenever `compendium` does (it's the
  // useMemo's only dep), so listing `scanner` alone in the effect below is
  // sufficient — `compendium` doesn't need to be repeated there.
  const scanner = useMemo(() => createScanner(compendium), [compendium])

  // Single state, set atomically by a single effect: fetch + scan + derive are
  // all side effects, so they can't live in useMemo, but splitting them across
  // two states/effects (an earlier version of this component did) left a
  // one-render window where a stale previous session's `rendered` value was
  // shown alongside the new session's (reset) fetch state. One state can't be
  // internally inconsistent with itself.
  const [rendered, setRendered] = useState<RenderedSegment[] | 'error' | null>(null)

  useEffect(() => {
    let alive = true
    setRendered(null)
    void fetchTranscript(session.id).then((segs) => {
      if (!alive) return
      if (segs === 'error') {
        setRendered('error')
        return
      }
      scanner.reset()
      setRendered(
        segs.map((seg, i) => ({
          key: `${seg.ts}-${i}`,
          text: seg.text,
          ranges: locateDetections(seg.text, scanner.scan(seg.text, seg.ts)),
        })),
      )
    })
    return () => {
      alive = false
    }
  }, [session.id, scanner])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-[var(--color-bg)]">
      <header
        className="safe-top flex items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to sessions"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-[var(--color-ink-dim)] active:scale-95"
          style={{ borderColor: 'var(--color-border)' }}
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-[var(--color-ink)]">
            {session.title || 'Untitled session'}
          </h1>
          <p className="truncate text-xs text-[var(--color-ink-dim)]">
            {formatStartedAt(session.startedAt)}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* aria-live scoped to the status messages only, not the populated
            transcript below — see the identical note in SessionBrowser. */}
        <div role="status" aria-live="polite">
          {rendered === 'error' && (
            <p className="px-2 py-12 text-center text-sm text-[var(--color-ink-dim)]">
              Couldn't load this transcript. Check your connection and try again.
            </p>
          )}

          {rendered === null && (
            <p className="px-2 py-12 text-center text-sm text-[var(--color-ink-dim)]">
              Loading…
            </p>
          )}

          {rendered !== null && rendered !== 'error' && rendered.length === 0 && (
            <p className="px-2 py-12 text-center text-sm text-[var(--color-ink-dim)]">
              No transcript recorded for this session.
            </p>
          )}
        </div>

        {rendered !== null && rendered !== 'error' && rendered.length > 0 && (
          <div className="flex flex-col gap-3">
            {rendered.map((seg) => (
              <p
                key={seg.key}
                dir="auto"
                className="text-sm leading-relaxed text-[var(--color-ink)]"
              >
                {renderSegment(seg, onSelectEntry)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function renderSegment(
  seg: RenderedSegment,
  onSelectEntry: (entry: CompendiumEntry) => void,
): ReactNode {
  if (seg.ranges.length === 0) return seg.text

  const nodes: ReactNode[] = []
  let cursor = 0
  seg.ranges.forEach((r) => {
    if (r.start > cursor) nodes.push(seg.text.slice(cursor, r.start))
    const colorVar = kindMeta(r.detection.entry.kind).colorVar
    nodes.push(
      <button
        key={r.start}
        type="button"
        onClick={() => onSelectEntry(r.detection.entry)}
        className="inline rounded px-0.5 font-semibold underline decoration-2 underline-offset-2"
        style={{ color: colorVar }}
      >
        {seg.text.slice(r.start, r.end)}
      </button>,
    )
    cursor = r.end
  })
  if (cursor < seg.text.length) nodes.push(seg.text.slice(cursor))

  return nodes
}
