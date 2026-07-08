// Hebrew-script tokenization + romanization for cross-script matching (issue #3).
//
// Sessions are spoken in Hebrew; both Soniox and Deepgram Hebraize un-seeded
// English game terms during streaming (e.g. "fireball" -> פיירבול). The Latin
// tokenizer (`latinTokens` in ../lib/text) only ever sees Latin-script runs, so
// Hebraized terms are invisible to it by design. This module gives the scanner
// a second, Hebrew-specific path: extract Hebrew word tokens, then romanize
// each one into a bounded set of plausible Latin spellings so the existing
// phonetic matcher (double-metaphone, via `../lib/text`) can still find the
// SRD entry.
//
// Hebrew script is inherently ambiguous for this purpose: ordinary (unpointed)
// writing has no vowels, and several letters double up consonant sounds
// (פ = p/f, ב = b/v, ו = v/o/u). There is no single "correct" romanization, so
// `romanizeVariants` produces a handful of candidates rather than committing
// to one, and downstream phonetic matching absorbs the residual ambiguity.

// Hebrew letters + niqqud/cantillation points + geresh/gershayim, so a whole
// pointed word is captured as one run before we strip the points back out.
const HEBREW_RUN = /[֑-״]+/g

// Niqqud/cantillation marks (֑-ׇ) and geresh/gershayim (׳-״)
// are punctuation/diacritics, not letters — strip them so only base letters
// remain for tokenizing and romanization.
const HEBREW_MARKS = /[֑-ׇ׳״]/g

/**
 * Extract raw Hebrew-script word tokens (marks stripped; Hebrew has no case to
 * fold). Mirrors `latinTokens`'s role for the Latin path, but for Hebrew runs.
 */
export function hebrewTokens(input: string): string[] {
  const matches = input.match(HEBREW_RUN)
  if (!matches) return []
  return matches.map((w) => w.replace(HEBREW_MARKS, '')).filter(Boolean)
}

// Letter -> plausible Latin transliteration(s), in rough likelihood order.
// א/ע are (usually) silent glottal placeholders in loanword transliteration;
// the empty-string option lets them drop out of the romanized form entirely.
const LETTER_MAP: Readonly<Record<string, readonly string[]>> = {
  א: ['', 'a'],
  ב: ['b', 'v'],
  ג: ['g'],
  ד: ['d'],
  ה: ['h', ''],
  ו: ['o', 'v', 'u'],
  ז: ['z'],
  ח: ['ch', 'h'],
  ט: ['t'],
  י: ['i', 'y', 'ee'],
  כ: ['k', 'ch'],
  ך: ['k', 'ch'],
  ל: ['l'],
  מ: ['m'],
  ם: ['m'],
  נ: ['n'],
  ן: ['n'],
  ס: ['s'],
  ע: ['', 'a'],
  פ: ['p', 'f'],
  ף: ['p', 'f'],
  צ: ['tz', 'ts', 's'],
  ץ: ['tz', 'ts', 's'],
  ק: ['k'],
  ר: ['r'],
  ש: ['sh', 's'],
  ת: ['t'],
}

// Bound on how many candidate spellings we carry forward after each letter,
// so a long token can't blow up combinatorially (worst case here is bounded,
// not exponential in token length).
const MAX_VARIANTS = 12

/**
 * Expand a single Hebrew word token into a bounded set of plausible Latin
 * transliterations, combining each letter's alternatives. Unrecognized
 * characters (should not occur given `hebrewTokens` already strips marks) are
 * ignored rather than aborting the whole token.
 */
export function romanizeVariants(token: string): string[] {
  const letters = [...token].filter((ch) => LETTER_MAP[ch] !== undefined)
  if (letters.length === 0) return []

  let variants = ['']
  for (const ch of letters) {
    const options = LETTER_MAP[ch]
    const next: string[] = []
    for (const v of variants) {
      for (const opt of options) {
        next.push(v + opt)
      }
    }
    variants = [...new Set(next)].slice(0, MAX_VARIANTS)
  }
  return variants.filter(Boolean)
}

// Ultra-common Hebrew function words / verbs that show up in nearly every
// session utterance ("I cast...", "then...", "on the..."). Mirrors the Latin
// scanner's SINGLE_WORD_STOP_LIST in spirit: romanizing these is cheap to
// attempt but the phonetic collision risk against *some* SRD name is real and
// not worth it for words this common, so single-token romanization skips them.
// Curated alias hits (hebrewAliases.ts) are unaffected — this only guards the
// generic romanization+phonetic fallback.
export const HEBREW_STOP_WORDS: ReadonlySet<string> = new Set([
  'אני',
  'אתה',
  'את',
  'הוא',
  'היא',
  'אנחנו',
  'אתם',
  'הם',
  'הן',
  'אז',
  'ואז',
  'כי',
  'אבל',
  'גם',
  'לא',
  'כן',
  'של',
  'עם',
  'על',
  'אל',
  'זה',
  'זאת',
  'מטיל',
  'תוקף',
])

// Minimum Hebrew token length attempted for the romanization fallback.
//
// Short common Hebrew words phonetically collide with short SRD entries
// constantly (e.g. "שאולי" -> a romanized variant landing on "Chuul", "כדאי"
// -> "Gate"/"Cat"/"Goat", "לנוח" -> "Lion") purely because both sides are short:
// double-metaphone codes for 3-5 letter strings are generic enough to match
// *something* in a few-hundred-entry SRD index almost every time. Real
// Hebraized game terms this fallback exists for (the "long tail beyond the
// curated map" — see hebrewAliases.ts) tend to be multi-syllable loanwords
// that romanize to 6+ Latin letters, so raising the floor here is a targeted,
// generalizable confidence-bar increase (not a per-word denylist entry) that
// filters out the short-word collision class without touching true positives.
export const MIN_HEBREW_TOKEN_LENGTH = 6

// Hebrew's inseparable one-letter prefixes (ב-/ל-/ו-/ה-/מ-/כ-/ש-, roughly
// "in/with", "to", "and", "the", "from", "like", "that") attach directly to
// the following word with no space, so "ב" + "ניצוץ" becomes the single
// token "בניצוץ". `hebrewTokens` has no notion of a word boundary inside a
// token, so this is a best-effort strip, not a parse.
const HEBREW_PREFIX_LETTERS: ReadonlySet<string> = new Set(['ב', 'ל', 'ו', 'ה', 'מ', 'כ', 'ש'])

// Shortest remainder we'll accept after stripping a prefix letter. Below this,
// stripping produces noise (a 1-letter "word") rather than a plausible word.
const MIN_STRIPPED_WORD_LENGTH = 2

/**
 * If `token` starts with a single-letter inseparable Hebrew prefix and the
 * remainder is long enough to plausibly be a standalone word, return the
 * remainder. Otherwise return `undefined`.
 *
 * This is a *fallback alongside* the unstripped token, never a replacement:
 * callers should still try the original token too, since a token that
 * legitimately begins with one of these letters as part of its own spelling
 * needs the unstripped form to match.
 */
export function stripHebrewPrefix(token: string): string | undefined {
  if (token.length < MIN_STRIPPED_WORD_LENGTH + 1) return undefined
  if (!HEBREW_PREFIX_LETTERS.has(token[0])) return undefined
  const rest = token.slice(1)
  return rest.length >= MIN_STRIPPED_WORD_LENGTH ? rest : undefined
}
