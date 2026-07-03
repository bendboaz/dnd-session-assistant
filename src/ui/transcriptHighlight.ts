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

import { normalize } from '../lib/text'
import type { Detection } from '../matching/types'

export interface HighlightRange {
  start: number
  end: number
  detection: Detection
}

interface RawToken {
  start: number
  end: number
  norm: string
}

function rawTokensWithSpans(text: string): RawToken[] {
  const tokens: RawToken[] = []
  const re = /[a-zA-Z][a-zA-Z'’]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const norm = normalize(m[0])
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
