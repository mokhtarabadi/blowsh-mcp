# src/tools — Decisions

Chronological Architectural Decision Records for the MCP tool handlers. Newest last. Each entry: Context, Decision, Consequences, Rollback.

## 2026-11-11 — `fetch_web` empty extraction is a hard error, not a flagged success

**Context.** `fetch_web({ url, type: "markdown" })` returned a one-byte body (`"\n"`) with no error for a JS-heavy SPA behind bot protection, while the same call shape on a normal docs page returned ~17 KB. The render pipeline had no post-condition: `renderOnce` returned whatever the readability pass plus `html2markdown` produced, and `fetchWebInner` cached and served it. A caller could not distinguish "the page is empty" from "the renderer produced a shell and the extractor found nothing" — the worst failure shape for a research tool.

**Decision.** An empty or unreadable extraction throws `FetchError` with the stable code `empty.extraction` and the message `empty extraction for <url> via <source> [dom N chars, text M chars]`. One guard (`guardEmptyExtraction`) sits at the `render()` exit so every renderer branch is covered; the stitch, archive-snapshot, and pdf paths call the same guard because they bypass `render()`. Text types (`markdown`/`plain`/`pdf`) fail on whitespace-only output or output with no readable text; `type: "html"` fails only on a blank DOM, since its payload is markup and a shell is still diagnosable. Markdown retries once from the full DOM when the readability pass narrowed to an empty shell. Nothing empty is cached.

**Alternatives rejected.** (a) A flagged success (`emptyExtraction: true` plus a diagnostic in the body) — it keeps the "looks like success" shape the bug report is about, and AGENTS.md forbids error-shaped successes. (b) Guarding each of the seven `renderOnce` return sites — duplicated branches, easy to miss on the next renderer path.

**Consequences.** Image-only pages, PDF shells, and login walls that previously returned an empty string now throw. Agents get an actionable error naming the URL, the renderer branch, the DOM size, and the extracted text size. `renderOnce` now returns `RenderResult` instead of a bare string, which is the seam tests stub (Browsh and html2markdown are external binaries, absent on the dev host).

**Rollback.** The threshold and the failure behaviour are one branch in `guardEmptyExtraction` plus one constant (`EMPTY_EXTRACTION_CODE`); removing the guard call in `render()` and the three bypass call sites restores the previous empty-success behaviour.
