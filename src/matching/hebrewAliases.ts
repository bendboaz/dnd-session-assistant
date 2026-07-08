// Curated Hebrew -> SRD-alias map (issue #3).
//
// For common, high-value terms, naive per-letter romanization (see
// `hebrewText.ts`) is too ambiguous to trust: Hebrew script drops vowels and
// several letters double up consonant sounds, so there's no reliable single
// transliteration of e.g. פיירבול back to "fireball". Instead we hand-curate
// the Hebraized-phonetic and/or common-translated spellings DMs and STT
// providers actually produce for these terms, mapped straight to the
// normalized alias already indexed by the compendium loader (see
// `loader.ts:makeAliases`) so a hit here resolves via the existing, trusted
// `compendium.exact()` tier rather than inventing a new match method.
//
// Keys are normalized Hebrew phrases: marks stripped (see `hebrewText.ts`'s
// `hebrewTokens`), trimmed, single-spaced. Multi-word keys correspond to
// multiple adjacent Hebrew tokens joined with a single space by the scanner's
// window scan.

export const HEBREW_ALIAS_MAP: Readonly<Record<string, string>> = {
  // Fireball — the issue's own worked example: "מטיל פיירבול" ("casting
  // fireball") must resolve to Fireball.
  פיירבול: 'fireball',
  פייערבול: 'fireball',
  'כדור אש': 'fireball', // common Hebrew-translated name ("ball of fire")

  // Fire Bolt
  'פייר בולט': 'fire bolt',
  פייערבולט: 'fire bolt',
  'ניצוץ אש': 'fire bolt', // common Hebrew-translated name ("spark of fire")

  // Magic Missile
  'מגיק מיסייל': 'magic missile',
  'מגיק מיסל': 'magic missile',
  'קסם טיל': 'magic missile', // common Hebrew-translated name ("missile of magic")
  'חץ קסם': 'magic missile', // alt Hebrew-translated name ("arrow of magic")
}

function normalizeHebrewPhrase(phrase: string): string {
  return phrase.trim().replace(/\s+/g, ' ')
}

/**
 * Look up a (possibly multi-word) Hebrew phrase in the curated alias map.
 * Returns the normalized SRD alias to feed into `compendium.exact()`, or
 * `undefined` if this phrase isn't curated.
 */
export function resolveHebrewAlias(phrase: string): string | undefined {
  return HEBREW_ALIAS_MAP[normalizeHebrewPhrase(phrase)]
}

/** Widest curated phrase, in words, so the scanner knows how wide to window. */
export const HEBREW_MAX_ALIAS_WORDS = Math.max(
  1,
  ...Object.keys(HEBREW_ALIAS_MAP).map((k) => k.split(' ').length),
)
