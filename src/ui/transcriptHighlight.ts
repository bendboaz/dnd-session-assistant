// Maps Detection[] (from re-scanning stored transcript text) back onto character
// ranges in the original text, so TranscriptView can render inline highlights.
//
// Detection.matchedText is a normalized (lowercase, punctuation-stripped) phrase
// — not a literal substring of the original text, since lib/text.ts's normalize()
// strips accents/possessives/punctuation. To recover real character positions we
// retokenize the raw text with the same word regex latinTokens uses, keeping each
// token's original span, then walk the detections (already left-to-right and
// non-overlapping, since scan() consumes tokens in order) matching each one's
// normalized words against a contiguous run of raw tokens starting after the
// previous detection's end.
//
// The regex below is a case-insensitive duplicate of lib/text.ts's latinTokens
// pattern (that file is a frozen contract — see CLAUDE.md — so it isn't
// exported for reuse here). If latinTokens' word-boundary rules ever change,
// this must change to match, or detections silently stop lining up with the
// raw text; transcriptHighlight.test.ts's "token boundaries" test cross-checks
// the two against each other as a tripwire for that drift.

import { normalize } from '../lib/text'
import type { Detection } from '../matching/types'

export interface HighlightRange {
  start: number
  end: number
  detection: Detection
}

/** One raw (un-normalized) Latin token and its character span in the original text. */
export interface RawToken {
  start: number
  end: number
  norm: string
}

/** Exported only so tests can cross-check its tokenization against latinTokens. */
export function rawTokensWithSpans(text: string): RawToken[] {
  const tokens: RawToken[] = []
  // Both apostrophe forms are intentional, matching latinTokens: U+0027
  // (ASCII ') and U+2019 (curly '). Careful not to let an editor's
  // smart-quote autocorrect collapse these to a single character.
  const re = /[a-zA-Z][a-zA-Z'’]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const norm = normalize(m[0])
    // The `if (norm)` guard is defensive, not reachable today: the regex's
    // leading [a-zA-Z] guarantees every match starts with a letter that
    // survives normalize(), so norm can't actually be empty here.
    if (norm) tokens.push({ start: m.index, end: m.index + m[0].length, norm })
  }
  return tokens
}

/**
 * Locate each detection's matched phrase in `text`, in order. A detection that
 * can't be found (a normalization edge case) is silently skipped rather than
 * risk mis-highlighting the wrong words.
 */
export function locateDetections(text: string, detections: Detection[]): HighlightRange[] {
  const tokens = rawTokensWithSpans(text)
  const ranges: HighlightRange[] = []
  let cursor = 0

  for (const detection of detections) {
    // filter(Boolean) is deliberately forgiving of extra/doubled spaces in
    // matchedText, not just a guard for a fully-empty string.
    const words = detection.matchedText.split(' ').filter(Boolean)
    if (words.length === 0) continue

    for (let start = cursor; start <= tokens.length - words.length; start++) {
      let matches = true
      for (let k = 0; k < words.length; k++) {
        if (tokens[start + k].norm !== words[k]) {
          matches = false
          break
        }
      }
      if (matches) {
        ranges.push({
          start: tokens[start].start,
          end: tokens[start + words.length - 1].end,
          detection,
        })
        cursor = start + words.length
        break
      }
    }
  }

  return ranges
}
