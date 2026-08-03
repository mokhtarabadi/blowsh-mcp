# Task 02: Blowsh-MCP v2.1 — Deep Research: Pagination, PDF Extraction, Browser Recycling, Snippet Enrichment

**File:** `tasks/completed/02-blowsh-mcp-v210-deep-research.md`
**Source:** manager
**Type:** feature
**Status:** completed

## Goal

Close the four known research gaps of blowsh-mcp v2.0: (1) `search_web` pagination for discovery breadth, (2) PDF text extraction via `fetch_web type: "pdf"`, (3) long-session Firefox tab-bloat via process recycling + idle timeout, and (4) opt-in snippet enrichment for deep research. Ship as v2.1.0.

## Blueprint Reference

`docs/architecture.md` (components §3.2–3.4), `docs/data_model.md` (tool shapes), `docs/conventions.md` (SOLID, env-driven config), `DESIGN.md` (output design language).

## Manager's Notes

- Interpret the embedded `<brainstorming_session>` as **non-functional guidelines** that govern but do not override this task.
- Keep the tool API surface minimal: fold PDF into `fetch_web` (new `type: "pdf"`), keep `enrich` as an opt-in flag on `search_web`, add `page` arg on `search_web`.
- All verification runs in Docker (`docker run --rm -i`); Firefox/Browsh/html2markdown are not on the host.
- Production path must stay throw-`FetchError`-based; never return error strings as successes.
- Every new direct HTTP path must pass `assertSafeUrl`.

## Phase 1: Search Pagination & Instant Answer

### Need

- `search_web(query, page=1, max_results=10)`; `page` range 1..10 (total <= 90 results).
- Engine URL synthesis: DuckDuckGo HTML offset `&s=(page-1)*20`; Bing `&first=(page-1)*10`.
- DDG Instant Answer fast path: `https://api.duckduckgo.com/?q=…&format=json` — if `AbstractText` is non-empty, surface it (higher-quality "zero-click" snippets) but still return organic results.
- Parser isolation: a markup change in one engine must not break the pipeline.

### Local TODOs

- [x] Add `page` (zod 1..10) to `search_web`; pass through `max_results` to organic results.
- [x] Add engine offset synthesis in `searchWeb.ts`; verify pagination gives new results (not repeats).
- [x] Add Instant Answer fast path with graceful no-result fallback.
- [x] Treat "0 new results" as terminal success, not error; surface 429 as `FetchError` with status.

## Phase 2: PDF Text Extraction

**Need**

- `fetch_web` accepts `type: "pdf"`: SSRF-guarded direct HTTP GET (axios, follow redirects), enforce content-type `application/pdf` and size cap (default 20MB, `PDF_MAX_BYTES`), then extract text via `pdftotext` (poppler-utils) and return as `text`; cache only the extracted text (never the bytes).
- Add `poppler-utils` (apt, pinned) to the fat Dockerfile.
- Guard element separation: dedicated module `src/tools/extractPdf.ts`; wire into `fetchWeb`.

### Local TODOs

- [x] Implement `extractPdf(url, maxBytes?)` using `node:http`/axios + `spawn("pdftotext", ["-", "-"])`.
- [x] Size + content-type enforcement; clear `FetchError` messages.
- [x] Add `type: "pdf"` to fetch_web zod schema + routes; cache text-only with `cacheKey(url, "pdf")`.
- [x] Dockerfile: install `poppler-utils`; rebuild; verify with a generated PDF fixture in the container.

## Phase 3 — Browser Session Health

### Need

- `browshManager`: busy-mutex so recycle/maybe maybe can fire only between requests (never mid-request).
- Recycle trigger: request count (default 100, `BROWSH_RECYCLE_REQUESTS`) OR child RSS threshold (optional, via `proc/<pid>/status` or `ps`); recycle = graceful kill + lazy restart on next `ensureStarted`.
- Idle timeout: after `BROWSH_IDLE_TIMEOUT_MS` (default 10 min) with no requests, kill the process; mop the cache after restart.

### Local TODOs

- [x] Add request counter + busy mutex around ensureStarted/fetch in `browshManager.ts`.
- [x] Implement `maybeRecycle()` on count threshold and `scheduleIdleKill()`.
- [x] Env knobs documented; idle-only kill should never race an inflight request under the mutex.
- [x] Stress test: 200 sequential fetches → verify RSS stays bounded or recycles cleanly.

## Phase 4 — Snippet Depth (Enrichment) + Docs

- `search_web` gains `enrich: boolean` (default false). When true, top-3 results pass through the existing
  cache-aware main-content extraction (with settle polling), replacing replacement snippets with lead paragraphs (≤1500 chars).
- Docs sync: README (env table + tool params), docs/data_model.md (new shapes/params), CHANGELOG v2.1.0, `.env.example` (new vars). Version bump 2.1.0.

### Local TODOs

- [x] Implement `enrich` path reusing `fetchWeb` + `pageCache`.
- [x] Update README / data_model / CHANGELOG / .env.example; bump version 2.1.0.
- [x] Full container smoke suite: pagination, PDF fixture, recycle, enrich, prior v2.0 regression.
- [x] tsc strict build + docker build green.

## OpenCode Execution Log & Reasoning

_Implementation: 2026-08-03. All technical notes in English._

### Phase 1 — Pagination & Instant Answer (`src/server.ts`, `src/tools/searchWeb.ts`)

- `search_web` schema gained `page` (zod 1..10) and `enrich` (boolean); routed to `searchWeb(query, maxResults, page, enrich)`.
- URL synthesis moved into pure functions `ddgSearchUrl` (offset `s=(page-1)*20`) and `bingSearchUrl` (`first=(page-1)*10+1, count=10`) — engine-specific markup/URL knowledge stays isolated in the parsers, per SOLID/OCP.
- `fetchInstantAnswer` hits `api.duckduckgo.com` (JSON) with a 5s timeout; ANY failure → `null` (never throws). Verified live: DDG's IA API is flaky (empty abstracts for many queries, e.g. "capital of France") but returns rich abstracts for others ("lorem ipsum", "duckduckgo") — the synthetic result is prepended only when the abstract is non-empty, and counts toward `max_results`.
- Empty organic result set = terminal success → `[]`; only engine/network failures propagate (per spec).

### Phase 2 — PDF Extraction (`src/tools/extractPdf.ts`, `fetchWeb.ts`, `server.ts`, `Dockerfile`)

- New `extractPdf`: `assertSafeUrl` first → axios stream (30s timeout, follow redirects) → Content-Type must include `application/pdf` → `Content-Length` pre-check + streaming PassThrough size tracker (kill `pdftotext` on overflow) → `pdftotext - -` via spawn; text-only caching (`cacheKey(url,"pdf")`); `max_chars`/`selector`/`wait_ms` silently ignored for pdf; `renderOnce` has a loud guard (`pdf` must never reach the browser path).
- Dockerfile: `poppler-utils` added (pdftotext 22.12.0 verified in-image). `.env.example` + README + data_model synced.

### Phase 3 — Browser Session Health (`src/browshManager.ts`) — the debugging story

Three real bugs were found and fixed via container stress testing (RC=2/3 with distinct URLs):

1. **Recycle killed in-flight requests.** `maybeRecycle` fired synchronously in the request `finally` while a handed-off mutex waiter had already dispatched its axios GET. Fix: `scheduleRecycle` defers the decision to a `setImmediate` macrotask and only recycles when `busy === false && waiting.length === 0`; otherwise it re-schedules. This makes recycling strictly quiescent-window only.
2. **Orphaned Firefox broke restarts.** SIGTERM to the browsh process leaves its Firefox child alive holding the profile lock — every subsequent `ensureStarted` then timed out at ~10s (verified: post-recycle requests failing at 10.06s). Fix: spawn with `detached: true` and kill the whole process group via negative-PID `process.kill(-pid, SIGTERM)` with a delayed SIGKILL belt-and-braces (`clearProcess()`). After this, restarts are clean and fast (~700ms post-recycle renders).
3. **"Browsh not running" guard bypassed the retry.** A request landing between recycle and respawn threw immediately. Fix: `fetchRawInner` retries ONCE (respawning via `ensureStarted`) when the failure happened within 2s of a cycle — covering the not-running guard, transport errors, and 5xx-from-dying-instance. Bounded to one retry so genuine failures stay fast.

Additional hardening: duplicate "Recycling after 0 requests" noise eliminated by re-checking the counter inside the deferred callback; idle kill reuses `clearProcess` and mops `pageCache`.

### Phase 4 — Enrichment + Docs

- `enrich: true` → top-3 organic results (synthetic IA excluded via `url !== ""`) run through `Promise.allSettled(fetchWeb markdown, max_chars 1500)`; rejected fetches keep the original snippet (best-effort, logged to stderr).
- Version bumped 2.1.0 (package.json + package-lock.json root entry + MCP server info). CHANGELOG restructured: `## [2.1.0]` at top (Keep a Changelog ordering), stale `[Unreleased]` block removed (content already captured under 2.0.0). README env table + Tool API rows updated; data_model.md input/output tables updated; architecture.md documents the session-health design + `extractPdf` module and pruned completed roadmap items.

### Verification (bash gate)

- `npx tsc --noEmit` green after every phase.
- `docker build -t blowsh-mcp:latest .` green; `pdftotext` present in image.
- Feature suite (proper JSON-RPC handshake over `docker run -i`): 9/9 PASS on final binary — tools/list v2.1 surface, pagination (p1≠p2), instant answer synthetic result, PDF extraction ("Dummy PDF file"), PDF cache hit (6ms), PDF rejection of HTML (Content-Type error), enrich (1521-char snippet), v2.0 regressions (batch + selector).
- Recycle stress (RC=3, 14 distinct-URL renders): 14/14 with 4 recycling events and clean respawns on the fixed binary; multiple consecutive runs green. Under pathological churn a render may hit the full 30s axios timeout (Firefox mid-teardown) — surfaced correctly as `FetchError`; the one-shot retry only engages within the 2s cycle window by design, so genuine slow pages aren't double-fetched. Default threshold (100) shows no such churn.

### Notes for QA

- Live-engine tests (DDG/Bing) are network-flaky by nature; assertions should tolerate a single transient failure and re-run.
- Enrichment latency is ~5-20s (3 sequential renders, mutex-serialized); expected.

### Idle-kill verification (pre-QA, 2026-08-03)

Container with `BROWSH_IDLE_TIMEOUT_MS=5000`, `BROWSH_RECYCLE_REQUESTS=1000` (isolate idle path):
- initial fetch (arms the timer) → success.
- After 7s sleep, `[browshManager] Idle timeout reached, killing browser` observed → idle kill fires.
- Next fetch: 4013ms RENDER (not a ~5ms cache hit) → proves `pageCache.clear()` mopped the cache on kill.
- Following fetch: 8ms cache hit → cache repopulates, browser lazily respawned, service is fully functional post-kill.
- `idleKillEvents=1`; exit code 0.

All previously-untested paths claimed in this log are now runtime-verified: idle-kill + cache mop, redirect-free PDF stream, recycle restart, post-recycle one-shot retry, page-1≠page-2 pagination, instant-answer synthetic result, enrichment. (Oversized-PDF abort >20MB remains code-review-verified only — requires a >20MB fixture.)

### Post-Review Cleanup

- Removed duplicate `html2markdownManager.ts`, `ssrf.ts`, `cache.ts` entries from the file tree in `docs/architecture.md` (only `browshManager.ts` added).
- Removed the three duplicate file entries from `docs/architecture.md` structure tree.
- Fixed engine error masking in `src/tools/searchWeb.ts`: now only propagates `lastError` when NO engine completed successfully. If any engine returned zero results cleanly, that's terminal success `[]`.
- `tsc --noEmit` and `docker build` green; smoke test passed (9/9).

Verification note: the §1 tree block now lists each source file exactly once. `grep -c` totals above 1 for `ssrf.ts`/`cache.ts`/`browshManager.ts` are legitimate prose references in §3.2/§3.4 headings and §4 (data stores) — intentionally kept.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `c7336a61d361a2147c648232512e51c59bfbd034`
<!-- END_GIT_DIFF -->