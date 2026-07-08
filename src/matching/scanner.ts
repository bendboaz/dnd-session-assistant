// Matching engine (WP-A).
//
// Turns a finalized transcript segment — mostly Hebrew with English game terms
// dropped in ("...אז אני מטיל fireball...") — into `Detection[]` via two
// independent passes:
//   - Latin pass: matches the Latin-script runs (`latinTokens`) directly
//     against the English SRD names.
//   - Hebrew pass: both Soniox and Deepgram Hebraize un-seeded English terms
//     during streaming (e.g. "fireball" -> פיירבול), so `latinTokens` alone
//     misses them. `hebrewTokens` extracts the Hebrew-script runs, then each
//     window is resolved via a curated Hebrew-alias map (`hebrewAliases.ts`)
//     or, for uncurated single tokens, a bounded set of romanized Latin
//     spellings (`hebrewText.ts`) phonetic-matched against the SRD index.
// Both passes share the same tiered lookup and per-entry cooldown below.
//
// Algorithm (each pass): greedy, longest-n-gram-first window scan with a
// tiered lookup and a per-entry cooldown.
//   1. Slide a window from `maxAliasWords` down to 1 word, anchored at the
//      current token, and join the window's tokens with spaces.
//   2. For each window try the cheapest/strictest tier first:
//        exact  -> compendium.exact(phrase)     confidence 1.0
//        phonetic -> compendium.phonetic(...)   confidence ~0.75
//        fuzzy  -> compendium.search(phrase)    confidence from rank
//   3. The first tier that yields a match wins for that window. We then advance
//      past every token the window consumed, so "fire ball" matched as Fireball
//      is not also re-scanned as "ball".
//
// Cooldown: an entry already emitted within `cooldownMs` is suppressed so a name
// repeated across a scene doesn't spam the feed. `now` is injectable so tests
// are deterministic.

import { latinTokens, phoneticKey } from '../lib/text'
import type { Compendium } from '../compendium/loader'
import type { CompendiumEntry } from '../compendium/types'
import type {
  Detection,
  MatchMethod,
  Scanner,
  ScannerOptions,
} from './types'
import { debugLog } from '../lib/logger'
import { resolveHebrewAlias, HEBREW_MAX_ALIAS_WORDS } from './hebrewAliases'
import {
  hebrewTokens,
  romanizeVariants,
  stripHebrewPrefix,
  HEBREW_STOP_WORDS,
  MIN_HEBREW_TOKEN_LENGTH,
} from './hebrewText'

const DEFAULT_COOLDOWN_MS = 60_000
const DEFAULT_MIN_CONFIDENCE = 0.6

// Phonetic matches are real but inherently lossy (homophones), so they sit below
// exact but comfortably above the default min-confidence floor.
const PHONETIC_CONFIDENCE = 0.75

// How many top fuzzy candidates to corroborate before giving up on a window.
const FUZZY_RANKS = 3

// Widest Hebrew window we try, in tokens. The curated alias map's longest key
// is a handful of words (e.g. "כדור אש"); the romanization fallback only ever
// runs on single tokens (see `matchHebrewWindow`). `HEBREW_MAX_ALIAS_WORDS`
// keeps this in sync with the curated map automatically.
const HEBREW_MAX_WINDOW = Math.max(2, HEBREW_MAX_ALIAS_WORDS)

// Stop-list guard against auto-detection spam.
//
// A pile of SRD entries are spelled exactly like ultra-common English words that
// the DM/players will say constantly without meaning the game object: a "shield"
// spell vs. "raise your shield", "light" the cantrip vs. "the light in the
// room", "fly" the spell vs. "let it fly". Auto-emitting a stat block every time
// one of these surfaces is pure noise.
//
// Heuristic (documented per the task): these words are blocked from *single-word*
// auto emission only. Two consequences:
//   - A single bare token equal to one of these is never auto-detected.
//   - But the word can still participate in a *longer* phrase ("mage hand",
//     "fire bolt", "wall of fire"), which is specific enough to be intentional.
// Nothing here is removed from the compendium, so WP-C's manual search box still
// finds every one of them. This is deliberately a small, hand-picked denylist of
// the worst offenders rather than a frequency model — it is easy to audit and
// extend, and false-negatives (a missed "shield" cast) are recoverable via
// manual search, whereas false-positives erode trust in auto-detection.
const SINGLE_WORD_STOP_LIST: ReadonlySet<string> = new Set([
  'shield',
  'club',
  'light',
  'fire',
  'fly',
  'net',
  'aid',
  'bless',
  'sleep',
  'heal',
  'slow',
  'haste',
  'web',
  'grease',
  'knock',
  'guidance',
  'mace',
  'dagger',
  'goggles',
  'jump',
  'guards',
  'darkness',
  'silence',
  'command',
  'enlarge',
  'reduce',
  'longsword',
  'shortsword',
  'spear',
  'whip',
  'sickle',
])

interface Match {
  entries: CompendiumEntry[]
  method: MatchMethod
  confidence: number
  /** Number of tokens this match consumed, so the scan can advance past them. */
  consumed: number
  /** The raw substring that triggered the match, for `Detection.matchedText`. */
  matchedText: string
}

/**
 * Map a fuzzy search rank to a confidence score. `compendium.search` returns
 * results best-first but does not expose Fuse scores, so we approximate: the top
 * hit is the most trustworthy and confidence decays with rank. This keeps fuzzy
 * matches below phonetic/exact while still clearing the min-confidence floor for
 * the best couple of candidates.
 */
function fuzzyConfidence(rank: number): number {
  return Math.max(0, 0.7 - rank * 0.1)
}

export function createScanner(
  compendium: Compendium,
  opts: ScannerOptions = {},
): Scanner {
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE
  const maxWindow = Math.max(1, compendium.maxAliasWords)

  // entryId -> last emission timestamp, for cooldown suppression.
  const lastEmit = new Map<string, number>()

  /**
   * Try to match the window of `width` tokens starting at `start`. Returns the
   * first tier (exact -> phonetic -> fuzzy) that produces an acceptable match,
   * or null. Single-token windows get the extra stop-list / strictness guards.
   */
  function matchWindow(tokens: string[], start: number, width: number): Match | null {
    const window = tokens.slice(start, start + width)
    if (window.length < width) return null
    const phrase = window.join(' ')
    const single = width === 1

    // --- Tier 1: exact name/alias. Always trustworthy, even single-word. ---
    const exact = compendium.exact(phrase)
    if (exact.length > 0) {
      // A single bare ultra-common word is suppressed from auto emission even
      // when it is a real exact SRD name (see SINGLE_WORD_STOP_LIST).
      if (single && SINGLE_WORD_STOP_LIST.has(phrase)) return null
      return { entries: exact, method: 'exact', confidence: 1.0, consumed: width, matchedText: phrase }
    }

    // Single-token fuzzy/phonetic is where false positives explode (every short
    // Hebrew-adjacent English word fuzzes onto *some* spell). Per the task, we
    // require single tokens to match *exactly* — so for width 1 we stop here.
    if (single) return null

    // --- Tier 2: phonetic (homophones, STT slop). ---
    // The compendium's phonetic key is built per-word, so a name written as one
    // word ("beholder") indexes under a single metaphone code while a split
    // utterance ("bee holder") would key as two. Try the spaced phrase first,
    // then the space-stripped concatenation so cross-word homophones still land.
    const phonetic =
      firstNonEmpty(compendium.phonetic(phrase), compendium.phonetic(window.join('')))
    if (phonetic.length > 0) {
      return { entries: phonetic, method: 'phonetic', confidence: PHONETIC_CONFIDENCE, consumed: width, matchedText: phrase }
    }

    // --- Tier 3: fuzzy (last-resort slop fallback for multi-word phrases). ---
    // `compendium.search` returns best-first but exposes no score, and it always
    // returns *something* — so blindly trusting the top hit would let any run of
    // running speech ("i cast fireball") swallow whatever entry happens to be
    // nearest, consuming the real exact match that follows. We therefore
    // CORROBORATE: a fuzzy candidate is accepted only if it phonetically lines
    // up with the window (spaced or concatenated). That keeps fuzzy as a genuine
    // homophone/mangling fallback rather than a catch-all.
    const want = phoneticKey(phrase)
    const wantJoined = phoneticKey(window.join(''))
    for (let rank = 0; rank < FUZZY_RANKS; rank++) {
      const hits = compendium.search(phrase, FUZZY_RANKS)
      const hit = hits[rank]
      if (!hit) break
      const corroborated = hit.aliases.some((a) => {
        const k = phoneticKey(a)
        return k === want || k === wantJoined
      })
      if (!corroborated) continue
      const confidence = fuzzyConfidence(rank)
      if (confidence >= minConfidence) {
        return { entries: [hit], method: 'fuzzy', confidence, consumed: width, matchedText: phrase }
      }
    }

    return null
  }

  /**
   * Resolve a Hebrew window against the curated alias map, also trying every
   * token with its leading one-letter inseparable prefix stripped (ב-/ל-/ו-/
   * ה-/מ-/כ-/ש-; see `stripHebrewPrefix`). Hebrew attaches these directly to
   * the following word with no space, so e.g. "אני משתמש בניצוץ אש" tokenizes
   * (via `hebrewTokens`) as "...", "בניצוץ", "אש" — the curated key "ניצוץ
   * אש" never matches the raw window "בניצוץ אש" unless we also try the
   * prefix-stripped form. The window is at most `HEBREW_MAX_ALIAS_WORDS`
   * tokens (currently 2), so trying every combination of
   * original/prefix-stripped per token is cheap and doesn't require guessing
   * which token (if any) actually carries a prefix.
   */
  function resolveCuratedAliasWithPrefixes(window: string[]): string | undefined {
    const optionsPerToken = window.map((token) => {
      const stripped = stripHebrewPrefix(token)
      return stripped ? [token, stripped] : [token]
    })
    for (const combo of cartesian(optionsPerToken)) {
      const alias = resolveHebrewAlias(combo.join(' '))
      if (alias) return alias
    }
    return undefined
  }

  /**
   * Try to match a window of Hebrew tokens starting at `start`. Two
   * independent mechanisms, tried in order:
   *   1. Curated alias map (`hebrewAliases.ts`) — deterministic, for common
   *      high-value terms where naive romanization is too ambiguous to trust.
   *      A hit resolves through `compendium.exact()`, so it's exact-tier
   *      confidence.
   *   2. Romanization + phonetic fallback — single Hebrew tokens only (a
   *      Hebraized English game term is normally written as one Hebrew word),
   *      long enough to not be an ultra-common function word/verb, expanded
   *      into plausible Latin spellings and phonetic-matched against the SRD
   *      name index. This is the "long tail beyond the curated map" path.
   */
  function matchHebrewWindow(tokens: string[], start: number, width: number): Match | null {
    const window = tokens.slice(start, start + width)
    if (window.length < width) return null
    const phrase = window.join(' ')

    const curatedAlias = resolveCuratedAliasWithPrefixes(window)
    if (curatedAlias) {
      const exact = compendium.exact(curatedAlias)
      if (exact.length > 0) {
        return { entries: exact, method: 'exact', confidence: 1.0, consumed: width, matchedText: phrase }
      }
    }

    if (width === 1 && phrase.length >= MIN_HEBREW_TOKEN_LENGTH && !HEBREW_STOP_WORDS.has(phrase)) {
      for (const variant of romanizeVariants(phrase)) {
        const hits = compendium.phonetic(variant)
        if (hits.length > 0) {
          return { entries: hits, method: 'phonetic', confidence: PHONETIC_CONFIDENCE, consumed: width, matchedText: phrase }
        }
      }
    }

    return null
  }

  /** Emit detections for a resolved match, honoring the per-entry cooldown. */
  function emit(matched: Match, now: number, detections: Detection[]): void {
    for (const entry of matched.entries) {
      const last = lastEmit.get(entry.id)
      if (last !== undefined && now - last < cooldownMs) {
        debugLog('scan:cooldown', {
          entry: entry.id,
          matchedText: matched.matchedText,
          suppressedUntil: last + cooldownMs,
        })
        continue
      }
      lastEmit.set(entry.id, now)
      debugLog('scan:detection', {
        entry: entry.id,
        name: entry.name,
        matchedText: matched.matchedText,
        method: matched.method,
        confidence: matched.confidence,
      })
      detections.push({
        entry,
        matchedText: matched.matchedText,
        method: matched.method,
        confidence: matched.confidence,
        ts: now,
      })
    }
  }

  // Latin-script pass: mostly-Hebrew transcript with English game terms
  // dropped in, matched by `latinTokens`.
  function scanLatin(text: string, now: number, detections: Detection[]): void {
    const tokens = latinTokens(text)

    let i = 0
    while (i < tokens.length) {
      let matched: Match | null = null
      // Greedy: widest window first, so "fire ball" beats "ball".
      const maxWidth = Math.min(maxWindow, tokens.length - i)
      for (let width = maxWidth; width >= 1; width--) {
        matched = matchWindow(tokens, i, width)
        debugLog('scan:candidate', {
          candidate: tokens.slice(i, i + width).join(' '),
          width,
          matched: matched !== null,
          method: matched?.method ?? null,
          confidence: matched?.confidence ?? null,
        })
        if (matched) break
      }

      if (!matched) {
        // A Latin token that was examined but produced no detection — a near-miss.
        debugLog('scan:miss', { token: tokens[i], position: i })
        i += 1
        continue
      }

      emit(matched, now, detections)
      i += matched.consumed
    }
  }

  // Hebrew-script pass: Hebraized English game terms (e.g. "fireball" ->
  // פיירבול), which `latinTokens` never sees. See `matchHebrewWindow`.
  function scanHebrew(text: string, now: number, detections: Detection[]): void {
    const tokens = hebrewTokens(text)

    let i = 0
    while (i < tokens.length) {
      let matched: Match | null = null
      const maxWidth = Math.min(HEBREW_MAX_WINDOW, tokens.length - i)
      for (let width = maxWidth; width >= 1; width--) {
        matched = matchHebrewWindow(tokens, i, width)
        debugLog('scan:hebrew-candidate', {
          candidate: tokens.slice(i, i + width).join(' '),
          width,
          matched: matched !== null,
          method: matched?.method ?? null,
          confidence: matched?.confidence ?? null,
        })
        if (matched) break
      }

      if (!matched) {
        debugLog('scan:hebrew-miss', { token: tokens[i], position: i })
        i += 1
        continue
      }

      emit(matched, now, detections)
      i += matched.consumed
    }
  }

  function scan(text: string, now: number = Date.now()): Detection[] {
    const detections: Detection[] = []
    scanLatin(text, now, detections)
    scanHebrew(text, now, detections)
    return detections
  }

  function reset(): void {
    lastEmit.clear()
  }

  return { scan, reset }
}

function firstNonEmpty(a: CompendiumEntry[], b: CompendiumEntry[]): CompendiumEntry[] {
  return a.length > 0 ? a : b
}

/**
 * Cartesian product of per-position option lists, e.g.
 * `[['a'], ['b','c']] -> [['a','b'], ['a','c']]`. Each position's first option
 * is preserved first in the output order, so the very first combo yielded is
 * always the "everything unstripped" original.
 */
function cartesian(optionsPerPosition: string[][]): string[][] {
  return optionsPerPosition.reduce<string[][]>(
    (acc, options) => acc.flatMap((prefix) => options.map((opt) => [...prefix, opt])),
    [[]],
  )
}
