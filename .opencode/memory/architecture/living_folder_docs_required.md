---
tags: [governance, docs, living-folder]
---

# Living folder docs are mandatory in every component directory

Every component or vertical-slice directory MUST hold both `README.md` and `DECISIONS.md`, and every primary source file in it MUST carry a one-line `// Sibling Docs: <dir>/README.md | Decisions: <dir>/DECISIONS.md` pointer at the top.

Verified in blowsh-mcp: `src/` and `src/tools/` each hold both files, and all 14 `src/*.ts` + `src/tools/*.ts` files carry the pointer (audit 2026-11-13).

`DECISIONS.md` entries MUST be grounded in verified code, never reconstructed from memory — an invented ADR is worse than no ADR, because a future agent treats it as authoritative.

Supersedes: none.