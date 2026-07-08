(e) **Tailwind CSS variables** — use `var(--color-...)` from `src/index.css`; never hard-coded hex
    colors. Flag any `#rrggbb`, `rgb(...)`, or `rgba(...)` value that belongs in the theme.

(f) **No `any` to silence TypeScript** — strict mode is on. Every `any` must have a comment
    explaining why it is unavoidable. Flag undocumented `any` suppressions.

(g) **API seams** — these files aren't frozen, but any change to an exported type/signature in them
    is an **API change**: it must be called out explicitly in the PR description, every dependent
    updated in the same PR, and `.agent-ops/REPO-FACTS.md` + `docs/DESIGN.md` kept consistent with
    the change. FLAG a PR that changes one of these signatures without doing all three — that's the
    contract break to catch, not the change itself:
    - `src/lib/text.ts`, `src/compendium/types.ts`, `src/matching/types.ts`, `src/stt/types.ts`.
    - **`src/compendium/loader.ts`** — the public `Compendium` interface (`loadCompendium()` return
      type; `exact`/`phonetic`/`search` method signatures) and `CompendiumEntry` + payload shapes are
      the API seam. Internal-only changes (alias generation, indexing, normalization helpers) need no
      callout.
    - **Test files (`*.test.ts`)** are exempt from all seam restrictions.

(h) **Mobile-first** — any UI change must remain usable at arm's length on a phone (large tap
    targets, readable text). Flag layout changes that break mobile usability.
