# src/tools — Decisions

Chronological Architectural Decision Records for the MCP tool handlers. Newest last. Each entry: Context, Decision, Consequences, Rollback.

## 2026-11-11 — `fetch_web` empty extraction is a hard error, not a flagged success

**Context.** `fetch_web({ url, type: "markdown" })` returned a one-byte body (`"\n"`) with no error for a JS-heavy SPA behind bot protection, while the same call shape on a normal docs page returned ~17 KB. The render pipeline had no post-condition: `renderOnce` returned whatever the readability pass plus `html2markdown` produced, and `fetchWebInner` cached and served it. A caller could not distinguish "the page is empty" from "the renderer produced a shell and the extractor found nothing" — the worst failure shape for a research tool.

**Decision.** An empty or unreadable extraction throws `FetchError` with the stable code `empty.extraction` and the message `empty extraction for <url> via <source> [dom N chars, text M chars]`. One guard (`guardEmptyExtraction`) sits at the `render()` exit so every renderer branch is covered; the stitch, archive-snapshot, and pdf paths call the same guard because they bypass `render()`. Text types (`markdown`/`plain`/`pdf`) fail on whitespace-only output or output with no readable text; `type: "html"` fails only on a blank DOM, since its payload is markup and a shell is still diagnosable. Markdown retries once from the full DOM when the readability pass narrowed to an empty shell. Nothing empty is cached.

**Alternatives rejected.** (a) A flagged success (`emptyExtraction: true` plus a diagnostic in the body) — it keeps the "looks like success" shape the bug report is about, and AGENTS.md forbids error-shaped successes. (b) Guarding each of the seven `renderOnce` return sites — duplicated branches, easy to miss on the next renderer path.

**Consequences.** Image-only pages, PDF shells, and login walls that previously returned an empty string now throw. Agents get an actionable error naming the URL, the renderer branch, the DOM size, and the extracted text size. `renderOnce` now returns `RenderResult` instead of a bare string, which is the seam tests stub (Browsh and html2markdown are external binaries, absent on the dev host).

**Rollback.** The threshold and the failure behaviour are one branch in `guardEmptyExtraction` plus one constant (`EMPTY_EXTRACTION_CODE`); removing the guard call in `render()` and the three bypass call sites restores the previous empty-success behaviour.

## 2026-11-13 — Parallel searches were serialized behind an unbounded render queue

**Context.** Multi-step parallel `search_web` calls (especially with `query_variants`) failed or timed out. The chain is not actually parallel: every render goes through one FIFO slot in `browshManager`, and `search_web` issues up to 6 renders per query (Tier 1 Google, Tier 2 Startpage, Tier 3 consensus pool of 4). With 3 queries that is 18 serialized renders. Two things made it worse: the per-render axios timeout started only *after* the slot was granted, so queue wait was unbounded and invisible to the caller; and `search_web` had no outer deadline unless the caller passed `deadline_ms`, so the client gave up while the server was still rendering.

**Decision.** Bound and abort the queue wait, then stop paying for dead tiers.

1. `RenderQueue` (extracted from `BrowshManager` so the contract is testable without a browser) takes the request's `AbortSignal` and a `BROWSH_QUEUE_TIMEOUT_MS` budget (default 600000 ms). A queued render that is cancelled or waits too long fails with an honest `FetchError`. A waiter that gives up stays in the queue marked `aborted`; `release()` skips it, so the slot is never handed to a settled promise.
2. `BROWSH_REQUEST_TIMEOUT_MS` default raised 30000 → 180000 ms, so a merely slow page is no longer a failed render. Raising a per-render timeout alone is incoherent — it sits in a ladder with the queue bound and the search budget (see the ladder ADR below), so all four budgets moved together.
3. A blocked-engine breaker remembers an engine whose page matched `isBlockedPage()` for 10 minutes and skips it on later searches. The breaker may only skip an engine while another candidate is untried, so it can never empty a working search.
4. `search_web` now runs under a budget for every call: `deadline_ms` when given, otherwise `SEARCH_DEADLINE_MS` (default 900000 ms). On expiry it aborts its in-flight renders (releasing the slot) and returns cheap-fallback partials or an honest `deadline.hit`. The `deadline_ms` ceiling rose 600000 → 1800000 ms.
5. Enrichment is clamped to the remaining search budget and each fetch inherits that remaining window.

**Alternatives rejected.** (a) First-success abort of the consensus pool — it would collapse the 4-engine consensus into winner-takes-all and break the documented ranking contract. (b) Shrinking the pool to two engines — same contract violation. Latency was recovered from dead tiers and bounded waits instead. (c) Bounding only the queue wait and leaving the overall call unbounded — the call could still run far past any client timeout.

**Consequences.** A render that would previously wait forever now fails with an honest error naming the queue wait. A search that exceeds its budget fails with `deadline.hit` at 180 s instead of hanging, which is a visible behaviour change for callers on very slow hosts; `deadline_ms` overrides it. A bot-blocked engine stops costing renders for 10 minutes, so the first search after a block still pays, later ones do not. `RenderQueue` is exported and covered by `tests/search-timeout-hardening-tests.ts` (no browser, no network).

**Rollback.** Each change is an independent edit: restore the `BROWSH_REQUEST_TIMEOUT_MS` and `SEARCH_DEADLINE_MS` defaults in `.env.example`, delete the breaker block in `searchWeb.ts`, and restore the previous `acquire()`/`release()` pair. The new env knobs are additive, so removing their use restores the previous behaviour exactly. The queue timer must stay referenced (not `unref()`ed) — an unreferenced queue timer never fires and turns the queue budget into a no-op.

## 2026-11-13 — The four timeout budgets are one ladder, not four knobs

**Context.** The first pass raised the per-render timeout to 90 s and left the search budget at 180 s. Those two numbers contradict each other: the queue wait alone was allowed 240 s, so the search budget could expire before the queue bound ever mattered, and 180 s funds only two of the up-to-six renders a query needs. Raising `BROWSH_REQUEST_TIMEOUT_MS` on its own (the literal request) would have made this worse, because a longer render inside a fixed budget means fewer renders fit.

**Decision.** Treat the budgets as one ladder and state the invariant: `SEARCH_DEADLINE_MS ≥ BROWSH_QUEUE_TIMEOUT_MS + BROWSH_REQUEST_TIMEOUT_MS`, and the queue funds at least two renders (`queue ≥ 2 × render`). Defaults moved together:

| Knob | Was | Now |
| --- | --- | --- |
| `BROWSH_REQUEST_TIMEOUT_MS` | 90000 | 180000 |
| `BROWSH_QUEUE_TIMEOUT_MS` | 240000 | 600000 |
| `SEARCH_DEADLINE_MS` | 180000 | 900000 |
| `ENRICH_BUDGET_MS` | 45000 | 180000 |
| `BROWSH_STARTUP_TIMEOUT_MS` | 60000 | 120000 |
| `deadline_ms` ceiling | 600000 | 1800000 |

The invariant is asserted in `tests/search-timeout-hardening-tests.ts` (the `timeout ladder` group) rather than four separate literal checks, so a future edit that raises one knob alone fails there with the actual arithmetic printed. Verified by lowering `SEARCH_DEADLINE_MS` to 300000: the suite reports `search budget (300000) covers queue + render (780000): FAIL — 300000 < 780000` and exits 1.

**Alternatives rejected.** (a) Raising only the render timeout, as literally requested — it breaks the budget arithmetic and produces more false timeouts, not fewer. (b) Removing the queue bound and relying on the search deadline alone — that reintroduces the unbounded wait the first pass fixed. (c) Hardcoding the invariant as a startup assertion that refuses to boot — a bad env value should still start and fail honestly per request, not take the server down.

**Consequences.** A slow host can now complete a full tier chain inside one budget. Worst-case latency for a single search rose from 180 s to 900 s, which is the point: the previous ceiling was too low to ever succeed on a cold or busy host. `BROWSH_STARTUP_TIMEOUT_MS` rose to 120 s so a slow cold start no longer fails the first fetch. The `deadline_ms` ceiling rose to 1800000 ms in the schema, the runtime clamp, and the docs together, so a schema-valid value can never be silently clamped lower again.

**Rollback.** Every value is an env knob with the previous number as a one-line edit; the ladder assertion reads the exported constants (`DEFAULT_RENDER_TIMEOUT_MS`, `DEFAULT_QUEUE_TIMEOUT_MS`, `DEFAULT_STARTUP_TIMEOUT_MS`, `ENRICH_BUDGET_MS`, `resolveSearchDeadline`), so restoring the old numbers restores the old behaviour and the old assertion results.
