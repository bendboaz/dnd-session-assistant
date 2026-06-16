"""AI PR review: send the PR diff to Claude with a checklist, print Markdown.

Reads the diff from a file (arg 1) to avoid shell-arg size/escaping limits.
Used by .github/workflows/ai-review.yml. Needs ANTHROPIC_API_KEY in the env.
"""

from __future__ import annotations

import sys

from anthropic import Anthropic

MODEL = "claude-opus-4-8"
MAX_DIFF_CHARS = 120_000  # guard against huge PRs blowing the context window

CHECKLIST = """You are reviewing a pull request for the "D&D Session Assistant" project.

Review the diff for:
  (a) adequate test coverage for the changed logic;
  (b) dead or deprecated code that should be removed;
  (c) project conventions (see CLAUDE.md):
      - Tailwind theme CSS variables, not hard-coded hex colors;
      - no `any` used merely to silence the TypeScript compiler;
      - the contract files must not be edited: src/lib/text.ts, src/compendium/*,
        src/matching/types.ts, src/stt/types.ts.

Be concise and specific (file + line where useful). Group findings by severity.
If everything looks good, say so briefly rather than inventing issues."""


def main() -> None:
    if len(sys.argv) < 2:
        print("_AI review: no diff file provided._")
        return
    with open(sys.argv[1], encoding="utf-8") as f:
        diff = f.read()

    if not diff.strip():
        print("_AI review: empty diff, nothing to review._")
        return

    truncated = len(diff) > MAX_DIFF_CHARS
    if truncated:
        diff = diff[:MAX_DIFF_CHARS]

    client = Anthropic()
    msg = client.messages.create(
        model=MODEL,
        max_tokens=1500,
        messages=[
            {
                "role": "user",
                "content": f"{CHECKLIST}\n\nDiff:\n```diff\n{diff}\n```",
            }
        ],
    )
    text = "".join(
        block.text for block in msg.content if getattr(block, "type", None) == "text"
    )
    print(text or "_AI review: model returned no text._")
    if truncated:
        print(f"\n\n_(diff truncated to {MAX_DIFF_CHARS} chars for review)_")


if __name__ == "__main__":
    main()
