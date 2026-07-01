(e) **Tailwind CSS variables** — use `var(--color-...)` from `src/index.css`; never hard-coded hex
    colors. Flag any `#rrggbb`, `rgb(...)`, or `rgba(...)` value that belongs in the theme.

(f) **No `any` to silence TypeScript** — strict mode is on. Every `any` must have a comment
    explaining why it is unavoidable. Flag undocumented `any` suppressions.

(g) **Contract files** — any change to an exported type/signature in the frozen files is a
    **contract break** that requires human sign-off (escalate, do not merge):
    - **Fully frozen** (no edit to exported types): `src/lib/text.ts`, `src/compendium/types.ts`,
      `src/matching/types.ts`, `src/stt/types.ts`.
    - **`src/compendium/loader.ts`** — only the public `Compendium` interface (`loadCompendium()`
      return type; `exact`/`phonetic`/`search` method signatures) and `CompendiumEntry` + payload
      shapes are frozen. FLAG any change to those exported signatures as a contract break;
      internal-only changes (alias generation, indexing, normalization helpers) are fine.
    - **Test files (`*.test.ts`)** are exempt from all contract restrictions.

(h) **Mobile-first** — any UI change must remain usable at arm's length on a phone (large tap
    targets, readable text). Flag layout changes that break mobile usability.
