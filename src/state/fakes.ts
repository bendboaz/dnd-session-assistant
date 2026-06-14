// Local fakes used while WP-A (matching) and WP-B (STT) are not yet merged into
// this worktree. They satisfy the real contracts (`Scanner`, `SttProvider`) so
// swapping in the real implementations is a one-line change — see SWAP markers
// in src/state/useAppStore.ts.

import type { Compendium } from '../compendium/loader'
import type { Detection, Scanner, ScannerOptions } from '../matching/types'
import type {
  SttCallbacks,
  SttProvider,
  SttProviderName,
  SttState,
  TranscriptSegment,
} from '../stt/types'

// ---- Fake Scanner -----------------------------------------------------------
//
// Mirrors the shape of WP-A's `createScanner`: a longest-first exact-name scan
// over the latin runs, with a cooldown. It is intentionally simple (no phonetic
// / fuzzy passes) — just enough to drive the feed from fake/real transcripts
// until the real engine lands. Replace the whole factory in one line.

export function createFakeScanner(
  compendium: Compendium,
  opts: ScannerOptions = {},
): Scanner {
  const cooldownMs = opts.cooldownMs ?? 60_000
  const lastSeen = new Map<string, number>()

  // Build a quick token list from the text, longest n-gram first per position.
  const scan = (text: string, now = Date.now()): Detection[] => {
    const tokens = (text.toLowerCase().match(/[a-z][a-z'’]*/g) ?? []).map((w) =>
      w.replace(/['’]/g, ''),
    )
    const out: Detection[] = []
    let i = 0
    while (i < tokens.length) {
      let matched = false
      for (let n = Math.min(compendium.maxAliasWords, tokens.length - i); n >= 1; n--) {
        const phrase = tokens.slice(i, i + n).join(' ')
        const hits = compendium.exact(phrase)
        if (hits.length) {
          const entry = hits[0]
          const prev = lastSeen.get(entry.id)
          if (prev === undefined || now - prev >= cooldownMs) {
            lastSeen.set(entry.id, now)
            out.push({
              entry,
              matchedText: phrase,
              method: 'exact',
              confidence: 1,
              ts: now,
            })
          }
          i += n
          matched = true
          break
        }
      }
      if (!matched) i++
    }
    return out
  }

  return {
    scan,
    reset: () => lastSeen.clear(),
  }
}

// ---- Fake STT provider ------------------------------------------------------
//
// Replays a scripted Hebrew+English transcript on a timer so the UI and the
// scanner can be exercised with no mic and no network. Matches WP-B's
// `FakeSttProvider` behavior closely enough that `createProvider('fake')` can
// drop in unchanged.

export interface FakeScriptLine {
  text: string
  /** Delay before this line, ms after the previous one (or after start). */
  delayMs: number
  isFinal: boolean
}

// A short mock session: mostly Hebrew narration with English game terms dropped
// in — exactly the code-switching the matching engine targets.
export const FAKE_SCRIPT: FakeScriptLine[] = [
  { text: 'אוקיי, אתם נכנסים למערה', delayMs: 1500, isFinal: true },
  { text: 'פתאום מופיע goblin מולכם', delayMs: 2500, isFinal: true },
  { text: 'אני מטיל fireball על הגובלין', delayMs: 3000, isFinal: true },
  { text: 'הקוסם מנסה להטיל shield', delayMs: 3000, isFinal: true },
  { text: 'מאחור צץ beholder ענק', delayMs: 3500, isFinal: true },
  { text: 'הוא מטיל עליך tasha\'s hideous laughter', delayMs: 3500, isFinal: true },
  { text: 'אתה עכשיו poisoned', delayMs: 3000, isFinal: true },
]

export function createFakeProvider(
  name: SttProviderName = 'soniox',
  script: FakeScriptLine[] = FAKE_SCRIPT,
): SttProvider {
  let state: SttState = 'idle'
  let timers: ReturnType<typeof setTimeout>[] = []
  let cbs: SttCallbacks | null = null
  let keyterms: string[] = []

  const setState = (s: SttState) => {
    state = s
    cbs?.onStateChange?.(s)
  }

  const clearTimers = () => {
    for (const t of timers) clearTimeout(t)
    timers = []
  }

  return {
    name,
    async start(callbacks: SttCallbacks) {
      cbs = callbacks
      setState('connecting')
      // Simulate a brief connect handshake, then stream the script.
      const startTimer = setTimeout(() => {
        setState('listening')
        let elapsed = 0
        for (const line of script) {
          elapsed += line.delayMs
          const at = elapsed
          timers.push(
            setTimeout(() => {
              const seg: TranscriptSegment = {
                text: line.text,
                isFinal: line.isFinal,
                startTime: at / 1000,
                ts: Date.now(),
              }
              cbs?.onSegment(seg)
            }, at),
          )
        }
      }, 600)
      timers.push(startTimer)
    },
    async stop() {
      clearTimers()
      setState('stopped')
    },
    setKeyterms(terms: string[]) {
      // Fake just records them; the real provider forwards to the STT service.
      keyterms = terms
      void keyterms
    },
    getState() {
      return state
    },
  }
}
