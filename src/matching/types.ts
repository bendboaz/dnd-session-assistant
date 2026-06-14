// CONTRACT FILE — shared between the matching engine and the UI.
// Owned by the orchestrator. Work packages must treat this as read-only;
// propose changes via the design doc rather than editing in a feature branch.

import type { CompendiumEntry } from '../compendium/types'

export type MatchMethod = 'exact' | 'phonetic' | 'fuzzy'

export interface Detection {
  entry: CompendiumEntry
  /** The raw transcript substring that triggered the match. */
  matchedText: string
  method: MatchMethod
  /** Heuristic confidence in [0, 1]. exact ≈ 1, phonetic/fuzzy lower. */
  confidence: number
  /** Epoch milliseconds when detected. */
  ts: number
}

export interface ScannerOptions {
  /** Don't re-emit the same entry within this window. Default 60_000. */
  cooldownMs?: number
  /** Minimum confidence required to emit a fuzzy/phonetic match. Default 0.6. */
  minConfidence?: number
}

export interface Scanner {
  /**
   * Feed a finalized transcript segment. Returns detections that are new
   * (i.e. not suppressed by the cooldown). `now` is injectable for tests.
   */
  scan(text: string, now?: number): Detection[]
  /** Clear cooldown state (e.g. when a new session starts). */
  reset(): void
}
