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
import type { SessionSummary, StoredSegment } from '../state/sessions'
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
  const [segments, setSegments] = useState<StoredSegment[] | 'error' | null>(null)

  // A scanner scoped to this view: fresh cooldown state per session opened, so
  // browsing one past session can't suppress detections in another. Scanning
  // segments in their stored chronological order with each segment's real `ts`
  // reproduces the same cooldown behavior the live scan would have applied.
  const scanner = useMemo(() => createScanner(compendium), [compendium])

  useEffect(() => {
    let alive = true
    setSegments(null)
    void fetchTranscript(session.id).then((segs) => {
      if (alive) setSegments(segs)
    })
    return () => {
      alive = false
    }
  }, [session.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // scanner.reset() is a side effect (mutates the scanner's cooldown state), so
  // this recomputation lives in an effect + state rather than useMemo, which
  // must stay pure.
  const [rendered, setRendered] = useState<RenderedSegment[] | null>(null)
  useEffect(() => {
    if (!segments || segments === 'error') {
      setRendered(null)
      return
    }
    scanner.reset()
    setRendered(
      segments.map((seg, i) => {
        const detections = scanner.scan(seg.text, seg.ts)
        return {
          key: `${seg.ts}-${i}`,
          text: seg.text,
          ranges: locateDetections(seg.text, detections),
        }
      }),
    )
  }, [segments, scanner])

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
        {segments === null && (
          <p className="px-2 py-12 text-center text-sm text-[var(--color-ink-dim)]">
            Loading…
          </p>
        )}

        {segments === 'error' && (
          <p className="px-2 py-12 text-center text-sm text-[var(--color-ink-dim)]">
            Couldn't load this transcript. Check your connection and try again.
          </p>
        )}

        {rendered !== null && rendered.length === 0 && (
          <p className="px-2 py-12 text-center text-sm text-[var(--color-ink-dim)]">
            No transcript recorded for this session.
          </p>
        )}

        {rendered !== null && rendered.length > 0 && (
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
