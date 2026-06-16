// Pure keyterm builder — no provider dependency, no cap applied here.
// The provider's clampKeyterms (e.g. ~100-term Soniox limit) still owns the cap.
//
// Keeping this separate from the store lets us unit-test the dedup/ordering
// logic without spinning up React or a compendium.

/**
 * Build the ordered keyterm list for STT seeding.
 *
 * Pinned names come first (user-prioritized); defaults fill the rest.
 * De-duplication is case-insensitive: if a name appears in both lists,
 * the pinned form is kept and the default copy is dropped.
 *
 * Neither input array is mutated.
 */
export function buildKeyterms(pinned: string[], defaults: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const name of pinned) {
    const key = name.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(name)
    }
  }

  for (const name of defaults) {
    const key = name.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(name)
    }
  }

  return result
}
