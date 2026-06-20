// Central app-state hook for WP-C. Owns the integration seam:
//   loadCompendium() -> scanner + STT provider -> detection feed -> transcript POST
//
// Wired to the real implementations: createScanner (WP-A, '../matching') and
// createProvider (WP-B, '../stt'). The offline fakes in ./fakes remain available
// for dev/tests but are no longer used here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadCompendium } from '../compendium/loader'
import type { Compendium } from '../compendium/loader'
import type { CompendiumEntry } from '../compendium/types'
import type { Detection, Scanner } from '../matching/types'
import type {
  SttProvider,
  SttProviderName,
  SttState,
  TranscriptSegment,
} from '../stt/types'
import { createScanner } from '../matching'
import { createProvider } from '../stt'
import { DEFAULT_KEYTERM_CANDIDATES } from '../stt/defaultKeyterms'
import { buildKeyterms } from '../stt/keyterms'
import { createSession, postTranscript, postNearMisses } from './transcript'
import { latinTokens } from '../lib/text'

/** A detection plus a feed-local id so React keys stay stable across re-renders. */
export interface FeedItem extends Detection {
  feedId: string
}

// Soniox is the default: with context-term seeding it returns dropped-in English
// game terms in *exact* Latin spelling during live streaming, so they match the
// SRD directly. (Deepgram's batch keeps Latin too, but its *streaming* Hebraizes
// the terms even with keyterms.) Override with VITE_STT_PROVIDER=deepgram.
const DEFAULT_PROVIDER: SttProviderName =
  import.meta.env.VITE_STT_PROVIDER === 'deepgram' ? 'deepgram' : 'soniox'

export const PINNED_IDS_KEY = 'dnd-assistant:pinned-ids'
const NEAR_MISS_CONTEXT_MAX_CHARS = 120
export const SESSION_ID_KEY = 'dnd-assistant:active-session-id'

/**
 * Read the persisted active session ID from localStorage.
 * Returns null on any failure (private mode, missing key, etc.).
 */
export function readSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_ID_KEY)
  } catch {
    return null
  }
}

/**
 * Write a session ID to localStorage so it survives page reloads.
 * Silently swallows errors (private mode, quota exceeded, etc.).
 */
export function writeSessionId(id: string): void {
  try {
    localStorage.setItem(SESSION_ID_KEY, id)
  } catch {
    // best-effort
  }
}

/**
 * Remove the persisted session ID from localStorage.
 * Called when the user explicitly ends a session.
 */
export function clearSessionId(): void {
  try {
    localStorage.removeItem(SESSION_ID_KEY)
  } catch {
    // best-effort
  }
}

/**
 * Read the persisted pinned entry IDs from localStorage.
 * Returns an empty array on any failure (private mode, quota errors, parse errors).
 */
export function readPinnedIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_IDS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

/**
 * Write the current pinned entry IDs to localStorage.
 * Silently swallows errors (private mode, quota exceeded, etc.).
 */
export function writePinnedIds(ids: string[]): void {
  try {
    localStorage.setItem(PINNED_IDS_KEY, JSON.stringify(ids))
  } catch {
    // best-effort
  }
}

/**
 * Resolve an ordered list of stored IDs to CompendiumEntry objects, silently
 * dropping any IDs that are no longer present in `entries` (stale references).
 * Pure function — suitable for unit testing without a React environment.
 */
export function resolvePinnedEntries(
  entries: CompendiumEntry[],
  ids: string[],
): CompendiumEntry[] {
  if (ids.length === 0) return []
  const byId = new Map(entries.map((e) => [e.id, e]))
  return ids.map((id) => byId.get(id)).filter((e): e is CompendiumEntry => e !== undefined)
}

let feedCounter = 0

export interface AppStore {
  // Loading
  loading: boolean
  loadError: string | null
  compendium: Compendium | null

  // Detection feed
  feed: FeedItem[]

  // STT
  sttState: SttState
  provider: SttProviderName
  setProvider: (p: SttProviderName) => void
  toggleListening: () => void

  // Session management
  endSession: () => void

  // Live transcript (latest finalized line, for the status area)
  lastTranscript: string

  // Pinning
  pinned: CompendiumEntry[]
  isPinned: (id: string) => boolean
  togglePin: (entry: CompendiumEntry) => void

  // Selection (which entry's stat block is open)
  selected: CompendiumEntry | null
  select: (entry: CompendiumEntry | null) => void
}

export function useAppStore(): AppStore {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [compendium, setCompendium] = useState<Compendium | null>(null)

  const [feed, setFeed] = useState<FeedItem[]>([])
  const [sttState, setSttState] = useState<SttState>('idle')
  const [provider, setProviderState] = useState<SttProviderName>(DEFAULT_PROVIDER)
  const [lastTranscript, setLastTranscript] = useState('')

  const [pinned, setPinned] = useState<CompendiumEntry[]>([])
  const [selected, setSelected] = useState<CompendiumEntry | null>(null)

  const scannerRef = useRef<Scanner | null>(null)
  const sttRef = useRef<SttProvider | null>(null)
  // Restored from localStorage on mount so the session survives page reloads.
  const sessionIdRef = useRef<string | null>(readSessionId())
  // Latest pinned names, read lazily so setKeyterms always sees fresh values.
  const pinnedNamesRef = useRef<string[]>([])
  // Common-term keyterm seed, validated against the loaded compendium.
  const defaultKeytermsRef = useRef<string[]>([])

  // ---- Load the compendium + build the scanner once -------------------------
  useEffect(() => {
    let alive = true
    loadCompendium()
      .then((c) => {
        if (!alive) return
        setCompendium(c)
        scannerRef.current = createScanner(c)
        // Keep only seed terms that actually exist in the SRD (drops non-SRD names).
        defaultKeytermsRef.current = DEFAULT_KEYTERM_CANDIDATES.filter(
          (n) => c.exact(n).length > 0,
        )

        // Rehydrate pinned entries from localStorage. Stale IDs (no longer in
        // the compendium) are silently dropped.
        const storedIds = readPinnedIds()
        if (storedIds.length > 0) {
          const rehydrated = resolvePinnedEntries(c.entries, storedIds)
          if (rehydrated.length > 0) {
            setPinned(rehydrated)
            pinnedNamesRef.current = rehydrated.map((e) => e.name)
            // Seed keyterms immediately so the first startListening call gets
            // the persisted pins even before the user interacts.
            sttRef.current?.setKeyterms(
              buildKeyterms(pinnedNamesRef.current, defaultKeytermsRef.current),
            )
          }
        }

        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // ---- Handle one finalized transcript segment ------------------------------
  const handleSegment = useCallback((seg: TranscriptSegment) => {
    // The UI and scanner only act on finals (interims would spam the feed).
    if (!seg.isFinal) return
    setLastTranscript(seg.text)

    const scanner = scannerRef.current
    if (scanner) {
      const detections = scanner.scan(seg.text, seg.ts)
      if (detections.length) {
        setFeed((prev) => [
          ...detections.map((d) => ({ ...d, feedId: `f${feedCounter++}` })).reverse(),
          ...prev,
        ])
      }

      // Collect near-misses: Latin tokens present in the segment but not covered
      // by any detection's matchedText. These are interesting for alias gap analysis.
      const sid = sessionIdRef.current
      if (sid) {
        const allTokens = latinTokens(seg.text)
        const coveredTokens = new Set<string>()
        for (const d of detections) {
          for (const t of latinTokens(d.matchedText)) coveredTokens.add(t)
        }
        const missedTokens = allTokens.filter((t) => !coveredTokens.has(t))
        if (missedTokens.length) {
          const nearMisses = missedTokens.map((token) => ({
            token,
            context: seg.text.slice(0, NEAR_MISS_CONTEXT_MAX_CHARS),
            ts: seg.ts,
          }))
          void postNearMisses(sid, nearMisses)
        }
      }
    }

    // Persist the segment (best-effort; tolerates an absent backend).
    // If the backend returns 404 the session is stale — clear it and create a
    // fresh one so the segment is not silently dropped.
    const sid = sessionIdRef.current
    if (sid) {
      void postTranscript(sid, [seg]).then(async (result) => {
        if (result === 'stale') {
          clearSessionId()
          sessionIdRef.current = null
          const newId = await createSession()
          if (newId) {
            sessionIdRef.current = newId
            writeSessionId(newId)
            void postTranscript(newId, [seg])
          }
        }
      })
    }
  }, [])

  // ---- Mic / STT lifecycle --------------------------------------------------
  const startListening = useCallback(async () => {
    if (!compendium) return
    const stt = createProvider(provider)
    sttRef.current = stt
    // Seed keyterms: pinned names first (priority), then the common-term defaults.
    stt.setKeyterms(buildKeyterms(pinnedNamesRef.current, defaultKeytermsRef.current))

    // Resume the persisted session or create a new one (best-effort).
    // The guard avoids re-creating the session on mic pause/restart.
    if (!sessionIdRef.current) {
      const newId = await createSession()
      sessionIdRef.current = newId
      if (newId) writeSessionId(newId)
    }

    await stt.start({
      onSegment: handleSegment,
      onStateChange: setSttState,
      onError: (err) => {
        console.error('[stt] error', err)
        setSttState('error')
      },
    })
  }, [compendium, provider, handleSegment])

  const stopListening = useCallback(async () => {
    const stt = sttRef.current
    sttRef.current = null
    if (stt) await stt.stop()
    setSttState('stopped')
  }, [])

  const toggleListening = useCallback(() => {
    const active =
      sttState === 'listening' ||
      sttState === 'connecting' ||
      sttState === 'reconnecting'
    if (active) void stopListening()
    else void startListening()
  }, [sttState, startListening, stopListening])

  // Deliberately end the current session so the next startListening creates a
  // fresh one (different D&D evening).
  const endSession = useCallback(() => {
    clearSessionId()
    sessionIdRef.current = null
    // If the mic is active, stop it too — the user is done with this session.
    if (sttRef.current) void stopListening()
  }, [stopListening])

  // Changing provider mid-session: stop the current stream so the next start
  // picks up the new provider.
  const setProvider = useCallback(
    (p: SttProviderName) => {
      setProviderState(p)
      if (sttRef.current) void stopListening()
    },
    [stopListening],
  )

  // ---- Pinning --------------------------------------------------------------
  const isPinned = useCallback(
    (id: string) => pinned.some((e) => e.id === id),
    [pinned],
  )

  const togglePin = useCallback((entry: CompendiumEntry) => {
    setPinned((prev) => {
      const exists = prev.some((e) => e.id === entry.id)
      const next = exists
        ? prev.filter((e) => e.id !== entry.id)
        : [...prev, entry]
      pinnedNamesRef.current = next.map((e) => e.name)
      // Persist the updated pinned ID set so it survives page reloads.
      writePinnedIds(next.map((e) => e.id))
      // Push fresh keyterms to a live provider immediately (pinned + defaults).
      sttRef.current?.setKeyterms(buildKeyterms(pinnedNamesRef.current, defaultKeytermsRef.current))
      return next
    })
  }, [])

  // Stop the mic when the app unmounts.
  useEffect(() => {
    return () => {
      void sttRef.current?.stop()
    }
  }, [])

  return useMemo(
    () => ({
      loading,
      loadError,
      compendium,
      feed,
      sttState,
      provider,
      setProvider,
      toggleListening,
      endSession,
      lastTranscript,
      pinned,
      isPinned,
      togglePin,
      selected,
      select: setSelected,
    }),
    [
      loading,
      loadError,
      compendium,
      feed,
      sttState,
      provider,
      setProvider,
      toggleListening,
      endSession,
      lastTranscript,
      pinned,
      isPinned,
      togglePin,
      selected,
    ],
  )
}
