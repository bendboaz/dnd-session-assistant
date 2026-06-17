"""AI PR review: send the PR diff to Claude with a checklist, print Markdown.

Reads the diff from a file (arg 1) to avoid shell-arg size/escaping limits.
Optionally reads an existing PR comment thread from a file (arg 2) so the
reviewer can skip points already addressed by the author.
Used by .github/workflows/ai-review.yml. Needs ANTHROPIC_API_KEY in the env.
"""

from __future__ import annotations

import sys

from anthropic import Anthropic

MODEL = "claude-sonnet-4-6"  # intended current model — not a placeholder
MAX_DIFF_CHARS = 120_000  # guard against huge PRs blowing the context window

CHECKLIST = """You are reviewing a pull request for the "D&D Session Assistant" project.

Review the diff for:
  (a) adequate test coverage for the changed logic;
  (b) dead or deprecated code that should be removed;
  (c) project conventions (see CLAUDE.md):
      - Tailwind theme CSS variables, not hard-coded hex colors;
      - no `any` used merely to silence the TypeScript compiler;
      - the contract files must not be edited: src/lib/text.ts, src/compendium/types.ts,
        src/matching/types.ts, src/stt/types.ts. For src/compendium/loader.ts only the public
        `Compendium` interface signature + CompendiumEntry/payload shapes are frozen — the loader's
        internal implementation may evolve. Specifically: FLAG any change to the exported
        `Compendium`, `loadCompendium`, or `CompendiumEntry` signatures in loader.ts as a contract
        break; internal-only changes (alias generation, indexing, helpers) are fine.
        Test files (*.test.ts) are exempt.

Be concise and specific (file + line where useful). Group findings by severity.
If everything looks good, say so briefly rather than inventing issues."""

THREAD_PREAMBLE = """The following is the prior PR review thread. Comments are prefixed with role
headers: [Reviewing Agent] = previous automated AI review, [Implementing Agent] = automated
Claude subagent implementing changes, [Human] = the PR author/reviewer.

Take the author's and implementer's replies into account. DO NOT re-raise points that have
already been addressed or explained in the thread. Focus on the current diff and anything
that is still unresolved or new.

--- PRIOR REVIEW THREAD ---
"""

REVIEW_HEADER = "🔎 **[Reviewing Agent]** — automated AI review"


def main() -> None:
    if len(sys.argv) < 2:
        print("_AI review: no diff file provided._")
        return
    with open(sys.argv[1], encoding="utf-8") as f:
        diff = f.read()

    if not diff.strip():
        print("_AI review: empty diff, nothing to review._")
        return

    # Optional second argument: existing PR comment thread
    prior_thread = ""
    if len(sys.argv) >= 3:
        try:
            with open(sys.argv[2], encoding="utf-8") as f:
                prior_thread = f.read().strip()
        except FileNotFoundError:
            pass  # First review — no prior thread yet

    truncated = len(diff) > MAX_DIFF_CHARS
    if truncated:
        # Truncate at the last newline before the cap so the fed diff stays well-formed
        # (avoids cutting mid-line, which can produce malformed diff hunks).
        cap = diff.rfind("\n", 0, MAX_DIFF_CHARS)
        diff = diff[: cap if cap != -1 else MAX_DIFF_CHARS]

    # Build prompt: prepend the prior thread when present so the model can skip
    # already-resolved issues before reading the diff.
    if prior_thread:
        prompt = (
            f"{CHECKLIST}\n\n"
            f"{THREAD_PREAMBLE}{prior_thread}\n--- END OF PRIOR THREAD ---\n\n"
            f"Diff:\n```diff\n{diff}\n```"
        )
    else:
        prompt = f"{CHECKLIST}\n\nDiff:\n```diff\n{diff}\n```"

    client = Anthropic()
    msg = client.messages.create(
        model=MODEL,
        max_tokens=1500,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
    )
    text = "".join(
        block.text for block in msg.content if getattr(block, "type", None) == "text"
    )
    review_body = text or "_AI review: model returned no text._"

    # Emit with the role header so readers can distinguish automated review
    # comments from human and implementing-agent comments (see CLAUDE.md §PR comment authorship).
    print(f"{REVIEW_HEADER}\n\n{review_body}")

    if truncated:
        print(f"\n\n_(diff truncated to {MAX_DIFF_CHARS} chars for review)_")


if __name__ == "__main__":
    main()
