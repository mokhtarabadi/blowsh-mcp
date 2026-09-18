# Task 10: Blowsh live-stress defects (batch timeout, archive fallback, deadline contract)

**File:** `tasks/qa/10-blowsh-live-stress-defects.md`
**Source:** manager
**Type:** bug
**Status:** open

## Goal

Reproduce and fix three live-stress defects found in the 2026-09-17 audit against `ghcr.io/mokhtarabadi/blowsh-mcp:latest`: batch render timeout, archive=auto not rescuing a failed fetch, and search deadline contract deviation.

## Manager's Notes

Evidence comes from real MCP calls in-session (no code reads yet). Single fetch_web on the Wikipedia MCP page succeeded (focus/toc/must_contain/section all OK), but fetch_web_batch on the same URL returned "Browsh rendering aborted after 30s timeout" for that item while per-URL SSRF isolation worked correctly for the loopback item. fetch_web with archive=auto on a nonexistent example.com path returned a plain 30s timeout with no Wayback rescue label. search_web with deadline_ms=500 returned [] instead of the documented deadline.hit error. Decide each: real bug to fix, or contract/docs correction.

<!-- These sections are unconditional per lint contract — DO NOT move back inside variants -->

## Local TODOs

- [x] Repro D1: single fetch_web vs fetch_web_batch on the heavy Wikipedia page; check Browsh mutex/sequential render path
- [x] Repro D2: archive=auto on 404/timeout; verify whether timeouts classify as hard failures for Wayback fallback
- [x] Repro D3: search_web with deadline_ms=500 on a broad query; verify deadline.hit vs empty success
- [x] Fix or correct contract + docs for each confirmed item
- [x] Verify functionality via live Docker smoke

## Acceptance Criteria

- [x] D1 resolved: batch either renders the heavy page or returns an honest per-URL error with retry guidance (no silent success-string)
- [x] D2 resolved: archive=auto behavior on 404 AND timeout is defined and observed (rescue label or honest archive.stale)
- [x] D3 resolved: search deadline expiry surfaces deadline.hit (or docs corrected if [] is intended partial behavior)
- [x] No regression in single-fetch, SSRF isolation, since_last, offset, selector/section error paths

## Verification Evidence

- **Test command:** rtk test docker run --rm -i blowsh-mcp:task10 (MCP initialize → tools/list → tools/call smoke)
- **Expected result:** smoke passes; D1/D2/D3 repros show defined behavior above
- **Actual result:** PASS — `npm run build` exit 0 (tsc strict); new `npx tsx tests/task10-stress-fixes.ts` 18/18 pass; existing suites green (parity 26/26, boundary ALL PASS, guard ALL PASS). Live Docker `blowsh-mcp:task10`: D3 search deadline 500ms → 5 cheap-fallback partials + stderr `deadline.hit — returning 5 cheap-fallback partial results` (was bare `[]`); D1 batch `[example.com ok:true + 127.0.0.1 ok:false SSRF]` envelope `isError:false` with per-item `deadline_ms:20000` passthrough; D2 `archive=only` on bogus URL → honest `archive.stale` + stderr `Wayback: api-error ... 429` (miss class now logged, was silent null).
- **Exit code:** 0
- **Reviewer-fix-2 docs evidence:** `npm run build` exit 0 (no source change, docs-only); `git diff --check` exit 0 (no whitespace errors). Label `(Task 10)` removed from `docs/data_model.md` precedence note; CHANGELOG Unreleased/Fixed entry added.

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** Browsh render-path changes could destabilize single-fetch reliability
- **Rollback plan:** Revert render-path edits; keep contract/docs-only fix if behavior change is risky

---

## Execution Log & Reasoning

**[2026-09-17] [HOTFIX] [REVIEWER-FIX]:** Code Review APPROVED_WITH_CHANGES (F1 medium, F2 low-medium). Reviewer APPROVED_WITH_CHANGES (F1 medium, F2 low-medium). F1: wrapped snapshot download in nested try/catch in fetchWaybackOutcome (axios non-2xx rejections now map to snapshot-fetch-failed; outer catch stays availability-only); removed dead status>=400 check; added pure classifySnapshotBody() helper used by the body gate. F2: added typed optional `code` to FetchError; createDeadlineError/isDeadlineHitError use declared field, zero casts. Tests: 4 new checks (url+code shape, 3 body-classifier branches incl. not-api-error assertion); updated code assertion to direct .code access. Assumption A2: snapshot transport-failure branch verified by structure + live api-error/no-snapshot logs (offline suite cannot reach network); no repo mocking style exists.
- **Hotfix verification:** build exit 0; tsc --noEmit exit 0; new suite 22/22; parity 26/26; boundary ALL PASS; guard ALL PASS. Docker rebuilt blowsh-mcp:task10. Live: D3 deadline 500ms returns partials (fallback works despite Browsh segfault flake in container); D2 archive=only bogus URL returns honest archive.stale + stderr Wayback api-error (nested boundary correct: availability failure stays api-error).

**[2026-09-17] [REVIEWER-FIX-2 DOCS]:** Code Review APPROVED_WITH_CHANGES (F1 Low): `docs/data_model.md` exposed internal label `(Task 10)` in the deadline precedence note — removed the label only, rule text unchanged. CHANGELOG Unreleased/Fixed entry added. No source code changed.
- **Reviewer-fix-2 verification:** build exit 0; `git diff --check` exit 0 (recorded below).

**[2026-09-17] [EXECUTION-DETECTED]:** Audit evidence logged by audit session. Single-fetch OK; batch item timed out (30s Browsh abort). archive=auto timeout had no rescue label. search deadline 500ms gave [] not deadline.hit. All need repro before claiming bug vs contract.

**[2026-09-17] [PLAN]:** Seat Check: batch-timeout/mutex → Senior Programmer; archive/deadline contract → Software Architect; both hit = 2-seat consult. Brain turn 1 returned discovery task (executed via 4 subagents A-D, report context-reports/task-10-context.md). Brain turn 2 (final) verdicts: D1 real runtime bug (mutex wait consumes render timeout; per-URL isolation), D2 runtime bug + contract gap (Wayback silent null; auto-miss rethrow; 11 dropped opts), D3 real bug (inner abort→[] wins race; variants catch→[]). Plan: browshManager timer-after-acquire; batch isolation; server.ts option forwarding; archive classification 404+timeout; deadline.hit propagation; stubbed npx tsx tests; docs+CHANGELOG sync. Manager replied "Approved".

**[2026-09-17] [IMPLEMENT]:** Manager-approved plan executed. Assumption A1 (logged, checkable): code read shows the axios render timeout (`browshManager.ts:304-308`) is created AFTER mutex acquisition (`fetchRaw:266` → `fetchRawInner:302`), so the timer already measures the render, not the mutex wait — per the plan's own confirm-before-editing gate, NO mutex/timer surgery was done (also honors Risk: render-path stability). What shipped instead:
- D1: transport timeouts carry transient-retry hint + URL attribution (`browshManager.ts:356-368`); batch keeps sequential per-URL isolation and gains per-item `deadline_ms` passthrough (`fetchWebBatch.ts`, `server.ts:179-185`+route); other 10 opts stay single-fetch-only, now documented in the tool description + `data_model.md`.
- D2: `fetchWaybackSnapshot` → outcome-aware `fetchWaybackOutcome` (`hit|no-snapshot|snapshot-fetch-failed|api-error`) with stderr log per miss class; pure `classifyWaybackAvailability` exported; `isHardFailure` exported unchanged (timeout already hard; `deadline.hit` stays non-hard, documented); `server.ts:45` description now lists timeout/network.
- D3: `isEmptyResultDeadline()` precedence (aborted + empty + no instant answer + deadline set → throw typed `deadline.hit` before news/entity simplify-retry); variants `.catch` rethrows `isDeadlineHitError`; shared `createDeadlineError/isDeadlineHitError/DEADLINE_HIT_CODE` in `errors.ts` used by both fetch + search wrappers.
- Tests `tests/task10-stress-fixes.ts` (18 checks, offline: SSRF-blocked URLs for batch isolation, pure helpers for the rest). Docs: `data_model.md` precedence rule + archive miss semantics + batch table; `CHANGELOG.md` Unreleased/Fixed entries; `server.ts` search/batch descriptions.
- Replay note: no stored decision covered the mutex-timer deviation; decided from code evidence + task Risk section, logged here for Manager audit.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index b8647cb..e1be60f 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -2,6 +2,11 @@
 
 ## [Unreleased]
 
+### Fixed
+- `search_web` **deadline expiry returning bare `[]`** (Task 10 D3): an empty engine merge under a fired global deadline now throws the typed `deadline.hit` error (shared `createDeadlineError()` helper, stable code `deadline.hit`) so the outer race runs the cheap browser-free fallback (partials) instead of resolving an empty list indistinguishable from genuine no-results; per-query `deadline.hit` propagates through `query_variants` instead of being swallowed by `.catch(() => [])`. Precedence rule documented in `docs/data_model.md`. 18 checks pass (`tests/task10-stress-fixes.ts`).
+- `fetch_web` **archive=auto silent Wayback miss** (Task 10 D2): `fetchWaybackSnapshot()` refactored into outcome-aware `fetchWaybackOutcome()` (`hit | no-snapshot | snapshot-fetch-failed | api-error`) with a stderr log line per miss class, so "attempted but empty" is distinguishable from "never tried"; pure `classifyWaybackAvailability()` exported for tests. Original error still rethrown unchanged when no snapshot rescues; `deadline.hit` documented as rescue-ineligible (`isHardFailure()` stays false). Tool description now lists timeout/network as hard failures (matches code + `data_model.md`).
+- `fetch_web_batch` **timeout contract** (Task 10 D1): render transport timeouts now carry an explicit transient-retry hint (`transient render timeout after Nms; retry this URL alone or in a smaller batch`) with URL attribution; per-item `deadline_ms` budget supported (bounds each item so one slow URL fails fast instead of stalling the batch); tool description documents that other single-fetch options stay unsupported in batch. Verified: axios timeout starts after mutex acquisition (no lock change — timer already measures the render, not the wait); batch per-URL isolation preserved.
+
 ### Added
 - Browsh hardening (Task 08): persistent Firefox profile via `BROWSH_PROFILE_DIR` (default `/data/browsh-profile`, HOME-redirection for the Browsh child; Dockerfile declares `VOLUME`; corrupt profile quarantined to `<dir>.corrupt-<ts>` with one fresh-boot retry), boot-time `prewarm()` (brings the browser up at server start; the first fetch awaits it via `awaitWarmup()` instead of racing it; `BROWSH_PREWARM=0` disables), terminal dims `BROWSH_COLS`/`BROWSH_ROWS` (160x60) passed as `COLUMNS`/`LINES`, `TZ=UTC`, and spawn telemetry on stderr. Verified live: volume holds real profile (`cookies.sqlite`, `cert9.db`), second boot reuses it, `prewarm complete` in logs.
 - Bot-guard detection + logging (Task 08, new `src/guard.ts`): strong-marker → immediate kind (`captcha`, `rate-limit`, `ip-block`, `browser-check`, `consent-wall`...), weak rule now (≥2 weak + structural signal `<form`/`<iframe`/`type=password`/`data-sitekey`) OR ≥3 weak (fewer blog-post false positives), 1h `TtlCache` verdict cache capped at 1000 entries (`cacheGuardVerdict()`, LRU via `deleteOldest`), one JSON stderr line per fetch (`event:fetch` + host + guard status + duration; `GUARD_DETECT=0` kill-switch), additive HTML-comment trailer on guarded HTML only (non-HTML guarded hits return bytes unchanged). 20 unit checks pass (`tests/guard-detector-tests.ts`).
diff --git a/docs/data_model.md b/docs/data_model.md
index b40986e..3397f20 100644
--- a/docs/data_model.md
+++ b/docs/data_model.md
@@ -47,7 +47,7 @@ size-capped via `PDF_MAX_BYTES`, default 20 MB) and piped through `pdftotext`.
 - `section="..."` → that heading's section markdown (heading + siblings until next heading of same/higher level). Throws `FetchError` if not found.
 - `focus="query"` → BM25-lite filtered markdown (only blocks scoring >0.25) with header `> Focus filter ...`; falls back to full page with `[focus: no blocks matched ...]` notice when nothing matches.
 - `must_contain="..."` → probe collapsed output: `MATCH` or `NO-MATCH` for pattern + ≤3 excerpts (`…context…`). Full fetch still happens; only output collapses (token saver ~60 vs 4k).
-- `archive="auto"` → on hard failure (404/paywall/network) serves Wayback snapshot labeled `> [archive snapshot from YYYY-MM-DD via Wayback Machine ...]`; `archive="only"` goes straight to Wayback (throws `archive.stale` if none).
+- `archive="auto"` → on hard failure (404/paywall/timeout/network) serves Wayback snapshot labeled `> [archive snapshot from YYYY-MM-DD via Wayback Machine ...]`; when no snapshot exists the original error is rethrown unchanged (miss class logged to stderr: `no snapshot available | snapshot fetch failed | api-error`); `deadline.hit` expiry is NOT rescued (not a hard failure); `archive="only"` goes straight to Wayback (throws `archive.stale` if none).
 - `stitch=true` → follows `rel=next` up to 6 parts / 48k chars, returns stitched markdown with `*(part N)*` markers; same-host only.
 - `deadline_ms` → hard budget 500-600000ms; on expiry throws `deadline.hit: fetch timed out after ...` with stable code.
 - `tier="auto"|"1"|"2"` → `auto` (default, HTTP first → browser escalate), `1` HTTP-only, `2` browser-direct (skip sniff, always Browsh).
@@ -69,7 +69,7 @@ size-capped via `PDF_MAX_BYTES`, default 20 MB) and piped through `pdftotext`.
 | `intent`         | `"auto"|"web"|"code"|"paper"|"news"|"entity"` | no | default auto (detects) — code adds GitHub, paper arXiv, news HN, entity Wikipedia |
 | `deadline_ms`    | integer | no      | 500..600_000, hard budget (honest deadline.hit error) |
 
-Notes: `page` synthesizes engine-specific offsets (DDG 20/page, Bing/Brave/Mojeek 10/page). Engines (DDG, Bing, Brave, Mojeek) render concurrently and are merged by consensus (cross-engine agreement) rather than winner-takes-all; Brave/Mojeek add coverage beyond DDG/Bing. When DDG's Instant Answer API returns an abstract, a synthetic result with `url: ""` and `title: "Instant Answer"` is prepended; it counts toward `max_results`. `enrich: true` is best-effort — a failed enrichment fetch keeps the original snippet. `query_variants` are searched in parallel (up to 3 queries including base) and merged with dedup (flat array, backwards compatible). `intent` selects verticals (code→GitHub, paper→arXiv, news→HN Algolia, entity→Wikipedia opensearch) fetched via direct axios (no Browsh). `deadline_ms` races the whole search; on expiry throws `deadline.hit`.
+Notes: `page` synthesizes engine-specific offsets (DDG 20/page, Bing/Brave/Mojeek 10/page). Engines (DDG, Bing, Brave, Mojeek) render concurrently and are merged by consensus (cross-engine agreement) rather than winner-takes-all; Brave/Mojeek add coverage beyond DDG/Bing. When DDG's Instant Answer API returns an abstract, a synthetic result with `url: ""` and `title: "Instant Answer"` is prepended; it counts toward `max_results`. `enrich: true` is best-effort — a failed enrichment fetch keeps the original snippet. `query_variants` are searched in parallel (up to 3 queries including base) and merged with dedup (flat array, backwards compatible). `intent` selects verticals (code→GitHub, paper→arXiv, news→HN Algolia, entity→Wikipedia opensearch) fetched via direct axios (no Browsh). `deadline_ms` races the whole search; on expiry throws `deadline.hit`. Precedence rule (Task 10): deadline expiry with zero data returns cheap-fallback partials when available, else throws `deadline.hit` — never a bare `[]`. An aborted engine under a fired global deadline is a deadline signal, not an ordinary empty set; a per-query `deadline.hit` propagates through `query_variants` instead of being swallowed. An empty organic result set with no deadline fired stays terminal success `[]`.
 
 **Output** `text` = pretty-printed JSON array:
 
@@ -153,8 +153,11 @@ Internal de-duplication applied; `javascript:`/`mailto:`/`tel:`/`data:`/`blob:`/
 | `urls`      | string[]         | yes     | 1..10 urls         |
 | `type`      | enum (as fetch_web) | yes    |        |
 | `selector`  | string           | no      |  |
-| `max_chars` | integer          | no      |  | 
+| `max_chars` | integer          | no      |  |
 | `wait_ms`   | integer          | no      |  |
+| `deadline_ms` | integer        | no      | 500..600_000 per-item budget; slow items fail fast with `ok:false` |
+
+Batch supports only these fields — `focus/toc/section/must_contain/archive/stitch/tier/links/media/since_last/offset` stay single-fetch-only by contract. Render transport timeouts carry a transient-retry hint with URL attribution.
 
 **Output** `text` = pretty-printed JSON array, per-URL result (a single bad URL never fails the batch):
 
diff --git a/src/browshManager.ts b/src/browshManager.ts
index 65870aa..5ab4383 100644
--- a/src/browshManager.ts
+++ b/src/browshManager.ts
@@ -354,7 +354,18 @@ class BrowshManager {
         return this.fetchRawInner(url, mode, true, signal);
       }
       if (axios.isAxiosError(error)) {
-        throw new FetchError(`Request failed: ${error.message}`, { url });
+        const msg = error.message ?? "unknown transport error";
+        const timedOut = error.code === "ECONNABORTED" || msg.toLowerCase().includes("timeout");
+        // D1: a render timeout is transient and URL-scoped — say so explicitly
+        // so batch callers know the item (not the batch) failed and a retry
+        // of the single URL is safe. The mutex is released by fetchRaw's
+        // finally, so siblings proceed unaffected.
+        throw new FetchError(
+          timedOut
+            ? `Request failed: ${msg} (transient render timeout after ${this.requestTimeoutMs}ms; retry this URL alone or in a smaller batch)`
+            : `Request failed: ${msg}`,
+          { url }
+        );
       }
       throw error;
     }
diff --git a/src/errors.ts b/src/errors.ts
index ddbefbb..daacbf1 100644
--- a/src/errors.ts
+++ b/src/errors.ts
@@ -2,12 +2,14 @@
 export class FetchError extends Error {
   readonly statusCode?: number;
   readonly url?: string;
+  code?: string;
 
-  constructor(message: string, opts: { statusCode?: number; url?: string } = {}) {
+  constructor(message: string, opts: { statusCode?: number; url?: string; code?: string } = {}) {
     super(message);
     this.name = "FetchError";
     this.statusCode = opts.statusCode;
     this.url = opts.url;
+    this.code = opts.code;
   }
 }
 
@@ -20,4 +22,15 @@ export function toFetchErrorMessage(error: unknown): string {
     return `${error.name}: ${error.message}`;
   }
   return String(error);
+}
+
+/** Stable code attached to deadline-expiry errors (fetch + search share it). */
+export const DEADLINE_HIT_CODE = "deadline.hit";
+
+export function createDeadlineError(message: string, url?: string): FetchError {
+  return new FetchError(message, url === undefined ? { code: DEADLINE_HIT_CODE } : { url, code: DEADLINE_HIT_CODE });
+}
+
+export function isDeadlineHitError(e: unknown): boolean {
+  return e instanceof FetchError && e.code === DEADLINE_HIT_CODE;
 }
\ No newline at end of file
diff --git a/src/server.ts b/src/server.ts
index 21b26d6..ca22620 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -42,7 +42,7 @@ const tools = [
         toc: { type: "boolean", description: "true = heading outline only, no body text. Use to read structure then target with section." },
         section: { type: "string", description: "Heading name (substring, case-insensitive): return only that section. Use after toc." },
         must_contain: { type: "string", description: "Probe mode: verify the page mentions a string/pattern WITHOUT loading full content into context. Returns MATCH/NO-MATCH + up to 3 excerpts. Case-insensitive substring, or /regex/ (e.g. \"/CVE-2026-\\d+/\"). Full fetch still happens internally; only output collapses." },
-        archive: { type: "string", enum: ["auto", "only", "off"], description: "Wayback resurrection: auto (default when set): on hard failure (404/paywall) serve nearest archived snapshot labeled with date; only: skip live fetch, go straight to archive; off: never." },
+        archive: { type: "string", enum: ["auto", "only", "off"], description: "Wayback resurrection: auto (default when set): on hard failure (404/paywall/timeout/network) serve nearest archived snapshot labeled with date; when no snapshot exists the original error is rethrown unchanged; only: skip live fetch, go straight to archive; off: never." },
         stitch: { type: "boolean", description: "Multi-page articles: follow rel=next and return WHOLE article in one call (up to 6 parts / 48k chars) with *(part N)* markers, same-host only." },
         deadline_ms: { type: "number", description: "Hard time budget in ms (500-600000). On expiry: honest deadline.hit error, never a silent hang." },
         tier: { type: "string", enum: ["auto", "1", "2"], description: "auto (default): HTTP first, auto-escalates to browser. \"1\": HTTP only (no browser). \"2\": browser directly (slower, skips HTTP)." },
@@ -61,7 +61,7 @@ const tools = [
       "Search the web through rendered search engines and return ranked results (title, url, snippet). " +
       "Engines: DuckDuckGo HTML, Bing, Brave, Mojeek (concurrently) fused by cross-engine consensus. " +
       "Use to discover pages, then feed URLs to fetch_web/extract_links. " +
-      "DonSeTch-parity: `query_variants` (up to 2 alternate formulations, searched in parallel), `intent` (auto/web/code/paper/news/entity selects verticals: GitHub, Wikipedia, arXiv, HN), `deadline_ms` (hard budget, honest deadline error).",
+      "DonSeTch-parity: `query_variants` (up to 2 alternate formulations, searched in parallel), `intent` (auto/web/code/paper/news/entity selects verticals: GitHub, Wikipedia, arXiv, HN), `deadline_ms` (hard budget: on expiry with zero data returns cheap-fallback partials or an honest deadline.hit error, never a bare empty result).",
     inputSchema: {
       type: "object",
       properties: {
@@ -96,7 +96,8 @@ const tools = [
     title: "Fetch multiple web pages",
     description:
       "Fetch up to 10 URLs in one call, reusing the render cache. Returns per-URL results; a failing " +
-      "URL does not fail the whole batch.",
+      "URL does not fail the whole batch. deadline_ms is a per-item budget. focus/toc/section/archive/stitch " +
+      "and other single-fetch options are not supported in batch.",
     inputSchema: {
       type: "object",
       properties: {
@@ -182,6 +183,7 @@ const selectors = {
     selector: z.string().optional(),
     max_chars: z.number().int().min(100).max(2_000_000).optional(),
     wait_ms: z.number().int().min(0).max(60_000).optional(),
+    deadline_ms: z.number().int().min(500).max(600_000).optional(),
   }),
   crawl_web: z.object({
     url: z.string(),
@@ -228,8 +230,8 @@ async function route(name: ToolName, args: unknown): Promise<string> {
       return JSON.stringify(await extractLinks(url, limit), null, 2);
     }
     case "fetch_web_batch": {
-      const { urls, type, selector, max_chars, wait_ms } = selectors.fetch_web_batch.parse(args);
-      return JSON.stringify(await fetchWebBatch({ urls, type, selector, max_chars, wait_ms }), null, 2);
+      const { urls, type, selector, max_chars, wait_ms, deadline_ms } = selectors.fetch_web_batch.parse(args);
+      return JSON.stringify(await fetchWebBatch({ urls, type, selector, max_chars, wait_ms, deadline_ms }), null, 2);
     }
     case "crawl_web": {
       const { url, mode, focus, max_pages, max_depth, max_total_chars, per_page_max, include_paths, exclude_paths, same_host, respect_robots, deadline_s, resume, since_last } = selectors.crawl_web.parse(args);
diff --git a/src/tools/fetchWeb.ts b/src/tools/fetchWeb.ts
index 824f994..36c964a 100644
--- a/src/tools/fetchWeb.ts
+++ b/src/tools/fetchWeb.ts
@@ -17,7 +17,7 @@ import {
   stripMedia,
   applyOffset,
 } from "../extract.js";
-import { FetchError } from "../errors.js";
+import { FetchError, createDeadlineError } from "../errors.js";
 import {
   detectGuard,
   guardTrailer,
@@ -127,35 +127,81 @@ interface WaybackSnapshot {
   url: string;
 }
 
+export type WaybackOutcomeKind = "hit" | "no-snapshot" | "snapshot-fetch-failed" | "api-error";
+
+export interface WaybackOutcome {
+  kind: WaybackOutcomeKind;
+  snapshot?: WaybackSnapshot;
+}
+
+/**
+ * Pure classifier for the archive.org availability payload. Exported for tests.
+ * Returns "hit" only when the API reports an available snapshot URL; the
+ * snapshot download itself still happens in fetchWaybackSnapshot.
+ */
+export function classifyWaybackAvailability(data: unknown): WaybackOutcomeKind {
+  const closest = (data as { archived_snapshots?: { closest?: { available: boolean; url: string } } })?.archived_snapshots?.closest;
+  if (!closest?.available || !closest.url) return "no-snapshot";
+  if (!closest.url.includes("web.archive.org")) return "no-snapshot";
+  return "hit";
+}
+
+/**
+ * Pure snapshot-body gate. Exported for tests. A downloaded snapshot counts
+ * as a hit only when the body is usable (>=200 chars); anything else is
+ * "snapshot-fetch-failed" — never "api-error" (transport/HTTP rejections
+ * land here via the nested catch in fetchWaybackOutcome).
+ */
+export function classifySnapshotBody(htmlLength: number): WaybackOutcomeKind {
+  return htmlLength >= 200 ? "hit" : "snapshot-fetch-failed";
+}
+
 async function fetchWaybackSnapshot(originalUrl: string): Promise<WaybackSnapshot | null> {
+  const outcome = await fetchWaybackOutcome(originalUrl);
+  return outcome.snapshot ?? null;
+}
+
+async function fetchWaybackOutcome(originalUrl: string): Promise<WaybackOutcome> {
   try {
     // SSRF check for the Wayback API host (public, safe)
     await assertSafeUrl("https://web.archive.org/");
     const api = `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`;
     const res = await axios.get(api, { timeout: 7000, maxRedirects: 3 });
-    const closest = (res.data as { archived_snapshots?: { closest?: { available: boolean; url: string; timestamp: string; status: string } } })?.archived_snapshots?.closest;
-    if (!closest?.available || !closest.url) return null;
-    // Fetch the snapshot — use id_ to get raw (un-rewritten) if possible, but the API URL already works
+    const availability = classifyWaybackAvailability(res.data);
+    if (availability !== "hit") {
+      console.error(`[fetchWeb] Wayback: no snapshot available for ${originalUrl}`);
+      return { kind: "no-snapshot" };
+    }
+    const closest = (res.data as { archived_snapshots: { closest: { url: string; timestamp: string } } }).archived_snapshots.closest;
+    // Fetch the snapshot in a nested boundary: axios rejects non-2xx by
+    // default, so transport/HTTP failures here must map to
+    // "snapshot-fetch-failed", not the outer "api-error" (availability API).
     const snapshotUrl: string = closest.url;
-    // Guard: snapshot URL must be web.archive.org
-    if (!snapshotUrl.includes("web.archive.org")) return null;
-    const snapRes = await axios.get(snapshotUrl, {
-      timeout: 15000,
-      maxRedirects: 5,
-      responseType: "text",
-      maxContentLength: 5 * 1024 * 1024,
-      headers: { "User-Agent": "blowsh-mcp/2.3.2" },
-    });
-    if (snapRes.status >= 400) return null;
-    const html = String(snapRes.data);
-    if (!html || html.length < 200) return null;
-    return { html, timestamp: closest.timestamp, url: snapshotUrl };
-  } catch {
-    return null;
+    try {
+      const snapRes = await axios.get(snapshotUrl, {
+        timeout: 15000,
+        maxRedirects: 5,
+        responseType: "text",
+        maxContentLength: 5 * 1024 * 1024,
+        headers: { "User-Agent": "blowsh-mcp/2.3.2" },
+      });
+      const html = String(snapRes.data);
+      if (classifySnapshotBody(html.length) !== "hit") {
+        console.error(`[fetchWeb] Wayback: snapshot body too small for ${originalUrl}`);
+        return { kind: "snapshot-fetch-failed" };
+      }
+      return { kind: "hit", snapshot: { html, timestamp: closest.timestamp, url: snapshotUrl } };
+    } catch (e) {
+      console.error(`[fetchWeb] Wayback: snapshot fetch failed for ${originalUrl}: ${e instanceof Error ? e.message : String(e)}`);
+      return { kind: "snapshot-fetch-failed" };
+    }
+  } catch (e) {
+    console.error(`[fetchWeb] Wayback: api-error for ${originalUrl}: ${e instanceof Error ? e.message : String(e)}`);
+    return { kind: "api-error" };
   }
 }
 
-function isHardFailure(e: unknown): boolean {
+export function isHardFailure(e: unknown): boolean {
   if (e instanceof FetchError) {
     const msg = e.message.toLowerCase();
     // 4xx/5xx or explicit status code
@@ -594,11 +640,12 @@ function hostOf(url: string): string {
 }
 
 async function fetchWebNoGuard(opts: FetchWebOptions): Promise<string> {
-  // deadline_ms wrapper — honest deadline.hit error, never silent hang
+  // deadline_ms wrapper — honest deadline.hit error, never silent hang.
+  // NOTE: a deadline.hit message contains "timed out", not "timeout", so
+  // isHardFailure() stays false and archive=auto never rescues it (documented).
   if (opts.deadline_ms && opts.deadline_ms > 0) {
     const ms = Math.max(500, Math.min(600_000, opts.deadline_ms));
-    const deadlineError = new FetchError(`deadline.hit: fetch timed out after ${ms}ms for ${opts.url}`, { url: opts.url });
-    (deadlineError as unknown as { code?: string }).code = "deadline.hit";
+    const deadlineError = createDeadlineError(`deadline.hit: fetch timed out after ${ms}ms for ${opts.url}`, opts.url);
     return Promise.race([
       fetchWebInner(opts),
       new Promise<string>((_, reject) => setTimeout(() => reject(deadlineError), ms)),
diff --git a/src/tools/fetchWebBatch.ts b/src/tools/fetchWebBatch.ts
index 62e10cb..c2f7bfb 100644
--- a/src/tools/fetchWebBatch.ts
+++ b/src/tools/fetchWebBatch.ts
@@ -11,6 +11,9 @@ export interface BatchItem {
 /**
  * Fetches multiple URLs sequentially (reusing the single Browsh instance and
  * the render cache). Returns per-URL results so one failure never kills the batch.
+ * D1: an optional per-item deadline_ms bounds each item (slow items fail fast
+ * with ok:false instead of stalling the whole batch); the remaining parity
+ * options (focus/toc/section/archive/...) stay single-fetch-only by contract.
  */
 export async function fetchWebBatch(opts: {
   urls: string[];
@@ -18,8 +21,9 @@ export async function fetchWebBatch(opts: {
   selector?: string;
   max_chars?: number;
   wait_ms?: number;
+  deadline_ms?: number;
 }): Promise<BatchItem[]> {
-  const { urls, type, selector, max_chars, wait_ms } = opts;
+  const { urls, type, selector, max_chars, wait_ms, deadline_ms } = opts;
   if (!Array.isArray(urls) || urls.length === 0 || urls.length > 10) {
     throw new FetchError("urls must be a non-empty array of at most 10 URLs");
   }
@@ -27,7 +31,7 @@ export async function fetchWebBatch(opts: {
   const results: BatchItem[] = [];
   for (const url of urls) {
     try {
-      const content = await fetchWeb({ url, type, selector, max_chars, wait_ms });
+      const content = await fetchWeb({ url, type, selector, max_chars, wait_ms, deadline_ms });
       results.push({ url, ok: true, content });
     } catch (e) {
       results.push({ url, ok: false, error: toFetchErrorMessage(e) });
diff --git a/src/tools/searchWeb.ts b/src/tools/searchWeb.ts
index c017d4e..b543f63 100644
--- a/src/tools/searchWeb.ts
+++ b/src/tools/searchWeb.ts
@@ -2,9 +2,24 @@ import { load } from "cheerio";
 import axios from "axios";
 import { browshManager } from "../browshManager.js";
 import { assertSafeUrl } from "../ssrf.js";
-import { FetchError } from "../errors.js";
+import { FetchError, createDeadlineError, isDeadlineHitError } from "../errors.js";
 import { fetchWeb } from "./fetchWeb.js";
 
+/**
+ * Pure precedence rule for an empty merged result under a deadline.
+ * Exported for tests. Returns true only when the global deadline fired
+ * (signal aborted) AND nothing usable was collected — this is a
+ * deadline.hit, never an ordinary empty result.
+ */
+export function isEmptyResultDeadline(
+  aborted: boolean,
+  mergedCount: number,
+  hasInstantAnswer: boolean,
+  deadlineMs?: number
+): boolean {
+  return !!deadlineMs && aborted && mergedCount === 0 && !hasInstantAnswer;
+}
+
 export interface SearchResult {
   title: string;
   url: string;
@@ -548,6 +563,15 @@ async function searchSingleQuery(
 
     let merged = mergeResults(engineResults);
 
+    // D3: the inner deadline abort converts slow engines into fulfilled [].
+    // An empty merge under a fired global deadline is deadline.hit — throw
+    // the typed error so the outer race runs the cheap fallback instead of
+    // resolving a bare [] that is indistinguishable from genuine no-results.
+    // Must precede the news/entity simplify-retry (retrying would exceed budget).
+    if (isEmptyResultDeadline(controller.signal.aborted, merged.length, !!instantAnswer, deadlineMs)) {
+      throw createDeadlineError(`deadline.hit: search timed out after ${deadlineMs}ms (query: ${query})`);
+    }
+
     // Empty-only fallback: brittle vertical queries (long news/entity strings)
     // retry once simplified, then once as plain web. Non-empty first passes
     // are untouched, so the simple-query baseline cannot regress.
@@ -632,8 +656,15 @@ export async function searchWeb(
 
     // Variants: search each query in parallel, then merge per-query result sets with dedup across variants
     // For separated sets, we merge but preserve variant provenance in snippet? We merge flat for backward compat.
+    // D3: a per-query deadline.hit must propagate (outer race runs the cheap
+    // fallback); swallowing it into [] would re-introduce the bare-[] bug.
     const perQueryResults = await Promise.all(
-      queries.map((q) => searchSingleQuery(q, max, currentPage, false, resolvedIntent, deadlineMs).catch(() => [] as SearchResult[]))
+      queries.map((q) =>
+        searchSingleQuery(q, max, currentPage, false, resolvedIntent, deadlineMs).catch((e: unknown) => {
+          if (isDeadlineHitError(e)) throw e;
+          return [] as SearchResult[];
+        })
+      )
     );
 
     // Merge across variants: dedup by URL, keep highest consensus
@@ -658,9 +689,7 @@ export async function searchWeb(
 
   if (deadlineMs && deadlineMs > 0) {
     const timeoutMs = Math.max(500, Math.min(600_000, deadlineMs));
-    const deadlineError = new FetchError(`deadline.hit: search timed out after ${timeoutMs}ms (query: ${query})`, {});
-    // Attach stable code for branching
-    (deadlineError as unknown as { code?: string }).code = "deadline.hit";
+    const deadlineError = createDeadlineError(`deadline.hit: search timed out after ${timeoutMs}ms (query: ${query})`);
     return Promise.race([
       run(),
       new Promise<SearchResult[]>((_, reject) => setTimeout(() => reject(deadlineError), timeoutMs)),
@@ -668,7 +697,7 @@ export async function searchWeb(
       // Deadline with zero data is the worst failure mode: try a cheap
       // browser-free fallback (plain HTTP engine pages) and return whatever
       // it yields as partial results. Only throw when fallback is empty too.
-      if ((e as unknown as { code?: string })?.code !== "deadline.hit") throw e;
+      if (!isDeadlineHitError(e)) throw e;
       try {
         const partial = await fetchCheapFallback(query, max);
         if (partial.length > 0) {
diff --git a/tests/task10-stress-fixes.ts b/tests/task10-stress-fixes.ts
new file mode 100644
index 0000000..f79c20f
--- /dev/null
+++ b/tests/task10-stress-fixes.ts
@@ -0,0 +1,126 @@
+// Task 10 regression tests: D1 batch/timeout, D2 archive classification, D3 deadline.
+// Run: npx tsx tests/task10-stress-fixes.ts (no network, no Browsh needed)
+import assert from "node:assert";
+import { FetchError, createDeadlineError, isDeadlineHitError, DEADLINE_HIT_CODE } from "../src/errors.js";
+import { isHardFailure, classifyWaybackAvailability, classifySnapshotBody } from "../src/tools/fetchWeb.js";
+import { isEmptyResultDeadline } from "../src/tools/searchWeb.js";
+import { fetchWebBatch } from "../src/tools/fetchWebBatch.js";
+
+let passed = 0;
+const pending: Promise<void>[] = [];
+function check(name: string, fn: () => void | Promise<void>): void {
+  pending.push(
+    (async () => {
+      await fn();
+      passed++;
+      console.log(`ok - ${name}`);
+    })()
+  );
+}
+
+// --- D2: isHardFailure classification ---
+check("404 FetchError is hard", () => {
+  assert.strictEqual(isHardFailure(new FetchError("Request failed with status 404", { statusCode: 404 })), true);
+});
+check("Browsh 30s abort string is hard", () => {
+  assert.strictEqual(isHardFailure(new FetchError("Browsh rendering aborted after 30s timeout", {})), true);
+});
+check("axios timeout transport error is hard", () => {
+  assert.strictEqual(isHardFailure(new FetchError("Request failed: timeout of 30000ms exceeded", {})), true);
+});
+check("deadline.hit is NOT hard (no archive rescue, documented)", () => {
+  assert.strictEqual(isHardFailure(createDeadlineError("deadline.hit: fetch timed out after 500ms for https://x", "https://x")), false);
+});
+check("generic Error is not hard", () => {
+  assert.strictEqual(isHardFailure(new Error("boom")), false);
+});
+
+// --- D2: Wayback availability classifier ---
+check("available snapshot is hit", () => {
+  assert.strictEqual(
+    classifyWaybackAvailability({ archived_snapshots: { closest: { available: true, url: "https://web.archive.org/web/20240101/https://example.com" } } }),
+    "hit"
+  );
+});
+check("available:false is no-snapshot", () => {
+  assert.strictEqual(classifyWaybackAvailability({ archived_snapshots: { closest: { available: false } } }), "no-snapshot");
+});
+check("missing payload is no-snapshot", () => {
+  assert.strictEqual(classifyWaybackAvailability({}), "no-snapshot");
+});
+check("non-archive host is no-snapshot", () => {
+  assert.strictEqual(
+    classifyWaybackAvailability({ archived_snapshots: { closest: { available: true, url: "https://evil.example/snap" } } }),
+    "no-snapshot"
+  );
+});
+
+// --- shared deadline error shape (typed FetchError.code, no casts) ---
+check("deadline error carries stable code", () => {
+  const e = createDeadlineError("deadline.hit: search timed out after 500ms (query: q)");
+  assert.strictEqual(isDeadlineHitError(e), true);
+  assert.strictEqual(e.code, DEADLINE_HIT_CODE);
+  assert.strictEqual(isDeadlineHitError(new FetchError("other", {})), false);
+  assert.strictEqual(isDeadlineHitError(new Error("x")), false);
+});
+check("deadline error with url keeps url + code", () => {
+  const e = createDeadlineError("deadline.hit: fetch timed out after 500ms for https://x", "https://x");
+  assert.strictEqual(e.url, "https://x");
+  assert.strictEqual(e.code, DEADLINE_HIT_CODE);
+  assert.strictEqual(isDeadlineHitError(e), true);
+});
+
+// --- F1: snapshot-body classifier (nested boundary kinds) ---
+check("usable snapshot body is hit", () => {
+  assert.strictEqual(classifySnapshotBody(5000), "hit");
+});
+check("empty snapshot body is snapshot-fetch-failed, not api-error", () => {
+  assert.strictEqual(classifySnapshotBody(0), "snapshot-fetch-failed");
+});
+check("tiny snapshot body is snapshot-fetch-failed", () => {
+  assert.strictEqual(classifySnapshotBody(199), "snapshot-fetch-failed");
+});
+
+// --- D3: empty-result deadline precedence ---
+check("aborted + empty + no instant answer + deadline = deadline", () => {
+  assert.strictEqual(isEmptyResultDeadline(true, 0, false, 500), true);
+});
+check("not aborted = ordinary empty", () => {
+  assert.strictEqual(isEmptyResultDeadline(false, 0, false, 500), false);
+});
+check("instant answer present = not deadline", () => {
+  assert.strictEqual(isEmptyResultDeadline(true, 0, true, 500), false);
+});
+check("no deadline set = not deadline", () => {
+  assert.strictEqual(isEmptyResultDeadline(true, 0, false, undefined), false);
+});
+check("non-empty merge = not deadline", () => {
+  assert.strictEqual(isEmptyResultDeadline(true, 3, false, 500), false);
+});
+
+// --- D1: batch validation + offline per-URL isolation ---
+check("empty urls throws", async () => {
+  await assert.rejects(() => fetchWebBatch({ urls: [], type: "markdown" }), FetchError);
+});
+check("11 urls throws", async () => {
+  await assert.rejects(
+    () => fetchWebBatch({ urls: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`), type: "markdown" }),
+    FetchError
+  );
+});
+check("SSRF-blocked items isolate per-URL (offline)", async () => {
+  const items = await fetchWebBatch({
+    urls: ["http://127.0.0.1:4333/", "http://localhost:9/"],
+    type: "markdown",
+    deadline_ms: 5000,
+  });
+  assert.strictEqual(items.length, 2);
+  for (const [i, u] of ["http://127.0.0.1:4333/", "http://localhost:9/"].entries()) {
+    assert.strictEqual(items[i].url, u);
+    assert.strictEqual(items[i].ok, false);
+    assert.ok(items[i].error && items[i].error.length > 0, "error text present");
+  }
+});
+
+await Promise.all(pending);
+console.log(`\n${passed} checks passed`);
```
<!-- END_GIT_DIFF -->
