// Shared text helpers for normalization, tokenization and phonetics.
// Used by both the compendium loader (building indexes) and the matching engine.

import { doubleMetaphone } from 'double-metaphone'

/**
 * Canonical form for matching/search: lowercase, accent-stripped, possessives
 * removed, punctuation dropped, whitespace collapsed.
 *   "Tasha's Hideous Laughter!" -> "tashas hideous laughter"
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip Latin diacritics
    .replace(/['’]s\b/g, 's') // possessive: tasha's -> tashas
    .replace(/['’]/g, '') // remaining apostrophes
    .replace(/[^a-z0-9]+/g, ' ') // any non-alphanumeric -> space
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Extract normalized Latin word tokens from arbitrary text. The transcript is
 * mostly Hebrew with English game terms dropped in; we only match on the Latin
 * runs ("fireball", "beholder"), so Hebrew is ignored here.
 */
export function latinTokens(input: string): string[] {
  const matches = input.toLowerCase().match(/[a-z][a-z'’]*/g)
  if (!matches) return []
  return matches.map((w) => normalize(w)).filter(Boolean)
}

/** Primary double-metaphone code for a single word ("" if not codeable). */
export function phoneticCode(word: string): string {
  const w = normalize(word).replace(/\s+/g, '')
  if (!w) return ''
  return doubleMetaphone(w)[0]
}

/** Phonetic key for a multi-word phrase: per-word primary codes joined. */
export function phoneticKey(phrase: string): string {
  return normalize(phrase)
    .split(' ')
    .map((w) => doubleMetaphone(w)[0])
    .filter(Boolean)
    .join(' ')
}
