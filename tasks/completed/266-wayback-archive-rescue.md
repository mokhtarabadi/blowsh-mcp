# Task 266: Wayback archive rescue silently fails when the availability API times out

**File:** `tasks/qa/266-wayback-archive-rescue.md`
**Source:** manager
**Type:** bug
**Status:** in-progress
**Submitted:** 2026-11-26T00:08:10Z
**Started:** 2026-11-25T23:54:30Z

## Source Context

### Variant C: Manager (`**Source:** manager`)

## Goal

Make `archive: "auto"` and `archive: "only"` actually rescue dead or failed fetches. Today the rescue reports "no snapshot" for URLs that are demonstrably archived, because the Wayback availability API returns a transient timeout payload that the classifier reads as a genuine miss. Replace or supplement the availability lookup with a reliable one (CDX), distinguish "no snapshot" from "API failed", and verify the rescue end to end.

## Manager's Notes

Found while answering the capability question ("can it gather everything?"). The Manager asked to "create backlog task for 1 item, and enough for today" — so this is scoped and queued, not executed now.

### Reproduction (verified against the running container)

`archive: "only"` on a URL that definitely has thousands of snapshots:

```
blowsh.fetch_web({ url: "https://www.yahoo.com", type: "markdown", archive: "only" })
→ FetchError: archive.stale: no Wayback snapshot for https://www.yahoo.com [archive=only]
```

Raw availability API from inside the container:

```
$ docker exec blowsh-singleton node -e "... fetch('https://archive.org/wayback/available?url=' + encodeURIComponent(u))"
https://www.yahoo.com    -> NO SNAPSHOT {"code":"timeout","message":"client timeout at 5.0 seconds"}
https://example.com      -> SNAPSHOT 20261113005606
https://www.wikipedia.org-> SNAPSHOT 20261111025218
```

Note the payload shape: HTTP **200**, `archived_snapshots: {}` empty, plus an `error` object. `classifyWaybackAvailability` (`src/tools/fetchWeb.ts:218-223`) only inspects `archived_snapshots.closest`, so it sees nothing and returns `"no-snapshot"` — an API failure is reported as a genuine miss.

### Root cause (diagnosed, not guessed)

1. **The availability API is unreliable for popular URLs.** It returned `client timeout at 5.0 seconds` for `yahoo.com` — the timeout is the API's own server-side budget, not ours, so raising our `axios` timeout does not help.
2. **The classifier cannot tell failure from absence.** It ignores the `error` field entirely, so both cases collapse to `"no-snapshot"`.
3. **`isHardFailure` never sees a status code.** Browsh answers HTTP 200 for everything, so `e.statusCode` is undefined and the rescue depends entirely on message matching.

### Verified alternative (the fix path)

Two working endpoints, both tested from inside the container:

```
# CDX API — returns the real archived timestamp
GET https://web.archive.org/cdx/search/cdx?url=<u>&output=json&limit=1&filter=statuscode:200&fl=timestamp,original
→ [["timestamp","original"], ["19961017235908","http://www2.yahoo.com:80/"]]

# Direct redirect — also works
GET https://web.archive.org/web/2024/<u>   (redirect: 'manual')
→ 302  location: https://web.archive.org/web/20250101000642/https://www.yahoo.com/
```

CDX is the better primary: it returns a precise timestamp and supports filters, so it can pick a 200-status snapshot rather than any snapshot.

### Out of scope

- **HTTP status reporting** (Browsh answers 200 for everything). Separate decision, needs an extra request per fetch; the Manager has not chosen a trade-off.
- **Interaction (click/type/press)**. Browsh 1.8.0 exposes no such endpoint; verified by inspecting the binary for route strings. A Playwright/Puppeteer backend is a separate project phase.

## Local TODOs

- [x] Fix `classifyWaybackAvailability` to read the `error` field and return `"api-error"` instead of `"no-snapshot"` on a transient failure
- [x] Add the CDX endpoint as the reliable fallback, keeping availability as the fast path
- [x] Make the rescue retry once on a transient API failure before giving up
- [x] Verify `isHardFailure` triggers the rescue for an abort-notice/empty-extraction failure (message-based path)
- [x] Add regression tests for: timeout payload → `api-error`, empty snapshots → `no-snapshot`, real CDX hit → `hit`, snapshot body too small → `snapshot-fetch-failed`
- [x] Verify live: `archive: "only"` and `archive: "auto"` rescue a dead URL
- [x] Update `docs/data_model.md`, `CHANGELOG.md`, and `src/tools/DECISIONS.md`; `DESIGN.md` unchanged because no error text changed

## Acceptance Criteria

- [x] `classifyWaybackAvailability` returns `api-error` (not `no-snapshot`) when the payload carries an `error` object or the snapshot list is empty with an error.
- [x] The rescue uses CDX as its reliable fallback and resolves a real timestamp for a URL the availability API times out on (regression case: `https://www.yahoo.com`).
- [x] A transient API failure is retried once before the rescue gives up.
- [x] `archive: "only"` on a genuinely archived URL returns the archived content with the `> [archive snapshot from ...]` banner.
- [x] `archive: "only"` on a URL with no snapshot anywhere still throws `archive.stale` (unchanged contract).
- [x] `archive: "auto"` rescues a failed live fetch when a snapshot exists, and rethrows the original error when none does.
- [x] No existing test regresses: `npm run build` exits 0 and all `tests/*.ts` suites exit 0.

## Verification Evidence

- **Test command:** `rtk test npx tsx tests/task10-stress-fixes.ts`
- **Expected result:** RED confirmation after adding CDX imports and regression checks, before implementation.
- **Actual result:** Exit 1 with `SyntaxError: The requested module '../src/tools/fetchWeb.js' does not provide an export named 'classifyCdxPayload'`. Full diagnostic retrieved with `rtk recall feddd862ed78ae51`.
- **Exit code:** 1

- **Test command:** `rtk test npx tsx tests/task10-stress-fixes.ts`
- **Expected result:** GREEN confirmation for classifier, CDX, retry, snapshot-body, deadline, and empty-extraction behavior.
- **Actual result:** 31 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npm run build`
- **Expected result:** strict TypeScript compilation succeeds.
- **Actual result:** `tsc` completed with no errors.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/proxy-config-tests.ts`
- **Expected result:** no proxy regression.
- **Actual result:** 17/17 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/search-timeout-hardening-tests.ts`
- **Expected result:** no timeout-ladder regression.
- **Actual result:** 52 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/browser-crash-circuit-tests.ts`
- **Expected result:** no browser lifecycle regression.
- **Actual result:** 49 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/empty-extraction-guard-tests.ts`
- **Expected result:** empty-extraction contract remains intact.
- **Actual result:** all checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/guard-detector-tests.ts`
- **Expected result:** bot-guard behavior remains intact.
- **Actual result:** all guard-detector tests passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/qa-boundary-tests.ts`
- **Expected result:** cache, offset, fingerprint, and SSRF boundaries remain intact.
- **Actual result:** all checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/search-engine-parser-tests.ts`
- **Expected result:** search parser behavior remains intact.
- **Actual result:** 11 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/search-parser-hardening-regression.ts`
- **Expected result:** parser hardening remains intact.
- **Actual result:** 9 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/multilingual-relevance-guard-regression.ts`
- **Expected result:** multilingual relevance behavior remains intact.
- **Actual result:** 17 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/verify-donsetch-parity.ts`
- **Expected result:** offset parity remains intact.
- **Actual result:** 26 passed, 0 failed.
- **Exit code:** 0

- **Test command:** `rtk test docker build -t blowsh-mcp:wayback-test .`
- **Expected result:** runtime image builds with the new archive rescue code.
- **Actual result:** Docker image built successfully.
- **Exit code:** 0

- **Test command:** `rtk test docker exec blowsh-singleton node -e "fetch('https://web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fwww.yahoo.com&output=json&limit=1&filter=statuscode%3A200&fl=timestamp%2Coriginal').then(async r=>{const t=await r.text(); console.log(t.slice(0,500));})"`
- **Expected result:** CDX returns a real successful snapshot for Yahoo.
- **Actual result:** `[["timestamp","original"],["19961017235908","http://www2.yahoo.com:80/"]]`.
- **Exit code:** 0

- **Test command:** `rtk test docker run --rm --network host -v /tmp/verify-266-archive.mjs:/app/verify-266-archive.mjs:ro blowsh-mcp:wayback-test node /app/verify-266-archive.mjs`
- **Expected result:** archive-only Yahoo rescue after one forced availability timeout, genuine-miss `archive.stale`, archive-auto rescue, and original-error rethrow all pass in Docker.
- **Actual result:** all four assertions passed. Diagnostic retries fixed only the test harness: module resolution required mounting under `/app`, and the genuine-miss URL needed a resolvable public host.
- **Exit code:** 0

- **Final fresh gate:** repeated `rtk test npm run build`, all 11 `rtk test npx tsx tests/*.ts` suites, `rtk test docker build -t blowsh-mcp:wayback-test .`, and the Docker live script after the final SSRF-boundary edit. All exited 0.
- **Task lint:** `lint_task_file` passed for `tasks/in-progress/266-wayback-archive-rescue.md`.
- **Markdown lint:** changed task, data-model, architecture, tool README, and tool decisions passed. `CHANGELOG.md` reports 23 pre-existing heading-spacing issues outside the changed `Unreleased` hunk; this repository configures no Markdown linter, and `git diff --check` passed.

> Verification runner rule: every suite and build above starts with `rtk test`. Raw output was retrieved only after failed RTK runs for diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded

## Risk & Rollback

- **Risk:** adding an outbound call to CDX adds latency to every rescue attempt. Mitigated by keeping the availability API as a fast path and only consulting CDX when it fails.
- **Risk:** CDX can return many rows for a URL; an unfiltered query could pick an error snapshot. Mitigated by `filter=statuscode:200` and `limit=1`.
- **Risk:** treating `api-error` as retryable could slow a genuinely dead URL. Mitigated by a single retry, then falling through to the original error.
- **Rollback plan:** the change is contained in `fetchWaybackOutcome` plus `classifyWaybackAvailability`. Restoring the previous function bodies returns the old behaviour; the new tests would then fail, which is the intended signal.

## Decision Log

**[2026-11-13] [D1] [EXECUTOR-DETECTED]:** CDX becomes the primary lookup; the availability API is demoted to a fast path.

- **Rationale:** CDX returned a real timestamp for the exact URL the availability API timed out on, and it supports `filter=statuscode:200`, so it can pick a snapshot that actually renders. Keeping availability first preserves the fast path for the common case.
- **Alternatives considered:** (a) raise the axios timeout on the availability call — rejected, the timeout is server-side (5.0 s) and not ours to raise. (b) replace availability entirely — rejected, it is one request versus CDX's heavier query for the common case.
- **Impact:** rescue works for popular URLs; a small extra latency only when the fast path fails.

**[2026-11-13] [D2] [EXECUTOR-DETECTED]:** Distinguish "API failed" from "no snapshot" in the outcome type rather than collapsing both.

- **Rationale:** the two demand different handling — a failure is worth a retry, an absence is not. Collapsing them is what made a transient timeout look like a permanent miss.
- **Alternatives considered:** retrying inside the classifier — rejected, it is pure and must stay testable.
- **Impact:** the existing `WaybackOutcomeKind` union already has `api-error`; this makes the code actually use it.

**[2026-11-26] [D3] [EXECUTION-DETECTED]:** The approved plan resolves the task's ambiguous "CDX primary" wording as availability fast path plus CDX fallback.

- **Rationale:** the Manager approved the Brain plan that explicitly keeps availability first for the common case and uses CDX after one `api-error` retry. This preserves latency while fixing the timeout regression.
- **Alternatives considered:** CDX-first for every rescue, which adds a heavier query to the common path and contradicts the approved plan.
- **Impact:** task wording now matches the implemented and approved contract.

---

## Execution Log & Reasoning

- Mode lock: AUTOMATIC (autopilot) for both backlog tasks, requested by the Manager.
- Input normalization: `sesssion` corrected to `session`.
- Assumption A1: execute the Wayback rescue first, then the WebRTC hardening, because the Manager named both without specifying order.
- Discovery recovery: both delegated scans returned idle without reports, so the executor verified the context map directly.
- Brain plan verdict: `REPORT` containing an integrated plan for both backlog fixes.
- Brainstorm: not required — both fixes are reversible bug fixes with no schema change or irreversible deployment.
- Plan artifact: `tasks/.sessions/ses_deafc52f0ffeni6fm59dFdc7pP_7dda7a6b/brain_outputs/resp_6b0774ad3427f9b90225449d_6071671f5a304abc9fc1e50a98338e0d.json`.
- Approval status: Manager selected `Approve plan` for the integrated plan.
- Claim status: moved to `tasks/in-progress/` by `claim_next`.
- Header repair: `claim_next` moved the file but left a stale `**File:**` path, so the executor corrected the header and re-ran lint.
- Implementation: added error-first availability classification, pure CDX parsing, SSRF-guarded CDX lookup, one retry, snapshot download reuse, and empty-extraction rescue eligibility.
- Verification: focused suite passes 31 checks, strict tsc passes, all 11 offline suites pass, Docker image builds, CDX returns Yahoo's archived timestamp, and all four Docker live archive assertions pass.
- Documentation: updated `docs/data_model.md`, `docs/architecture.md`, `src/tools/README.md`, `src/tools/DECISIONS.md`, and `CHANGELOG.md`.
- `DESIGN.md` unchanged: no error text change.
- Stack gate skip record: repo root `/home/mohammad/blowsh-mcp`; marker scan `package.json, tsconfig.json, src/ports/`; matched stack skills none; reason `no stack-specific blueprint matches this Node MCP server, so strict tsc is the gatekeeper`.
- Task-number discipline: the task number is omitted from living docs and retained only in this task file and `CHANGELOG.md`.
- Next action: run final task lint and transition to QA.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 9793b38..b002213 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -2,6 +2,10 @@
 
 ## [Unreleased]
 
+### Fixed
+
+- Wayback archive rescue no longer treats the availability API's transient timeout payload as a genuine miss. `classifyWaybackAvailability` now returns `api-error` for error-bearing payloads, `fetchWaybackOutcome` retries once, then queries CDX with `filter=statuscode:200&limit=1`. `archive: "only"` still throws `archive.stale` only on a true miss, `archive: "auto"` still rethrows the original live error when no snapshot exists, and `deadline.hit` remains rescue-ineligible. Empty-extraction failures now qualify for archive rescue. Regression coverage in `tests/task10-stress-fixes.ts` (31 checks). See Task 266.
+
 ## [2.9.1] - 2026-11-25
 
 ### Fixed
diff --git a/docs/architecture.md b/docs/architecture.md
index fcd9972..ffbc31b 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -69,7 +69,7 @@ blowsh-mcp/
 
 ### 3.3. Fetch Tools (`src/tools/`)
 
-- `fetchWeb`: plain (Browsh PLAIN), html (Browsh DOM), markdown (DOM + main-content extraction + html2markdown CLI), pdf (bypasses browser: SSRF-guarded direct download → `pdftotext`, size-capped via `PDF_MAX_BYTES`). Optional `selector` (CSS), `max_chars`, `wait_ms` (JS-settle polling until DOM stable) — ignored for `pdf`. v2.3.0 extras: `focus` (BM25-lite relevance filter, `focusFilter()` in extract.ts), `toc`/`section` (`extractToc`/`extractSectionHtml`), `must_contain` probe (`probeMustContain` → MATCH/NO-MATCH + excerpts), `archive` (Wayback `fetchWaybackSnapshot` on `archive=auto`/`only`), `stitch` (`fetchStitchedMarkdown` following `rel=next` up to 6 parts, same-host).
+- `fetchWeb`: plain (Browsh PLAIN), html (Browsh DOM), markdown (DOM + main-content extraction + html2markdown CLI), pdf (bypasses browser: SSRF-guarded direct download → `pdftotext`, size-capped via `PDF_MAX_BYTES`). Optional `selector` (CSS), `max_chars`, `wait_ms` (JS-settle polling until DOM stable) — ignored for `pdf`. v2.3.0 extras: `focus` (BM25-lite relevance filter, `focusFilter()` in extract.ts), `toc`/`section` (`extractToc`/`extractSectionHtml`), `must_contain` probe (`probeMustContain` → MATCH/NO-MATCH + excerpts), `archive` (Wayback availability fast path, one `api-error` retry, then SSRF-guarded CDX fallback for `archive=auto`/`only`), `stitch` (`fetchStitchedMarkdown` following `rel=next` up to 6 parts, same-host).
 - `extractPdf`: direct axios stream (SSRF-guarded, Content-Type + Content-Length + streaming size caps) piped through `pdftotext - -`; text-only caching.
 - `searchWeb`: Tiered keyless fallback chain — Google attempted first with robot-block detection; on clean results returns immediately (6x speedup); falls back to Startpage proxy second, and 4-engine consensus pool (Brave, Mojeek, Bing, DDG) third. Renders 4 engines (DDG, Bing, Brave, Mojeek) concurrently and merges by consensus (cross-engine agreement) rather than winner-takes-all; Brave/Mojeek parsers + `mergeResults()` + `queryCache` (intent-aware TTL). `page` (1-10) synthesizes engine offsets; DuckDuckGo Instant Answer API is probed first (graceful null on any failure), and optional `enrich` replaces top-3 snippets via cache-aware fetches. v2.3.0 adds `query_variants` (parallel, merged), `intent` (auto/web/code/paper/news/entity selects verticals: GitHub/Wikipedia/arXiv/HN via direct axios), `deadline_ms` (hard budget → `deadline.hit` error), and 4-engine + vertical fan-out.
 - `crawlWeb`: sitemap-aware crawl — `discoverSitemaps()` (robots.txt + sitemap.xml over axios, `parseSitemapXml`), frontier best-first (`scoreCandidate` BM25-lite over anchor+path), Governor pacing (dwell variance + crawl-delay + exponential backoff on 429), `effectiveExcludes`/`scopeAllowed` globs, robots `fetchRobots`/`isAllowed`, disk-backed resume tokens (`blowsh-crawl-resumes.json`, 30 min TTL, atomic rename) and `since_last` fingerprint file, `qualityScore`/`contentKind` heuristics, budgets (`max_pages`/`max_total_chars`/`deadline_s`), stop reasons.
@@ -93,7 +93,7 @@ blowsh-mcp/
 - **Firefox** (`firefox-esr` on Debian): JS engine + DOM renderer; `BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr`.
 - **html2markdown CLI** (v2.5.2): converts extracted HTML to Markdown.
 - **Search engines** (external, outbound): Google (`www.google.com/search`, attempted first with robot-block detection), Startpage (`www.startpage.com/sp/search`, Google-quality proxy), DuckDuckGo HTML (`html.duckduckgo.com`), Bing (`www.bing.com`), Brave (`search.brave.com`), Mojeek (`www.mojeek.com`).
-- **Verticals / archive / sitemaps (axios, no Browsh):** GitHub HTML, Wikipedia opensearch, arXiv export API, HN Algolia, Wayback `archive.org/wayback/available`, sitemap XML, robots.txt.
+- **Verticals / archive / sitemaps (axios, no Browsh):** GitHub HTML, Wikipedia opensearch, arXiv export API, HN Algolia, Wayback `archive.org/wayback/available` plus `web.archive.org/cdx/search/cdx`, sitemap XML, robots.txt.
 
 ## 6. Deployment & Infrastructure
 
diff --git a/docs/data_model.md b/docs/data_model.md
index f02cbfc..d26d203 100644
--- a/docs/data_model.md
+++ b/docs/data_model.md
@@ -47,7 +47,7 @@ size-capped via `PDF_MAX_BYTES`, default 20 MB) and piped through `pdftotext`.
 - `section="..."` → that heading's section markdown (heading + siblings until next heading of same/higher level). Throws `FetchError` if not found.
 - `focus="query"` → BM25-lite filtered markdown (only blocks scoring >0.25) with header `> Focus filter ...`; falls back to full page with `[focus: no blocks matched ...]` notice when nothing matches.
 - `must_contain="..."` → probe collapsed output: `MATCH` or `NO-MATCH` for pattern + ≤3 excerpts (`…context…`). Full fetch still happens; only output collapses (token saver ~60 vs 4k).
-- `archive="auto"` → on hard failure (404/paywall/timeout/network) serves Wayback snapshot labeled `> [archive snapshot from YYYY-MM-DD via Wayback Machine ...]`; when no snapshot exists the original error is rethrown unchanged (miss class logged to stderr: `no snapshot available | snapshot fetch failed | api-error`); `deadline.hit` expiry is NOT rescued (not a hard failure); `archive="only"` goes straight to Wayback (throws `archive.stale` if none).
+- `archive="auto"` → on hard failure (404/paywall/timeout/network/empty extraction) serves a Wayback snapshot labeled `> [archive snapshot from YYYY-MM-DD via Wayback Machine ...]`. The availability API is the fast path; an `api-error` payload or transport failure is retried once, then the CDX API is queried with `filter=statuscode:200&limit=1`. When no snapshot exists the original error is rethrown unchanged (miss class logged to stderr: `no snapshot available | snapshot fetch failed | api-error`); `deadline.hit` expiry is NOT rescued (not a hard failure); `archive="only"` goes straight to Wayback and throws `archive.stale` only on a genuine miss.
 - `stitch=true` → follows `rel=next` up to 6 parts / 48k chars, returns stitched markdown with `*(part N)*` markers; same-host only.
 - `deadline_ms` → hard budget 500-1800000ms; on expiry throws `deadline.hit: fetch timed out after ...` with stable code.
 - `tier="auto"|"1"|"2"` → `auto` (default, HTTP first → browser escalate), `1` HTTP-only, `2` browser-direct (skip sniff, always Browsh).
diff --git a/src/tools/DECISIONS.md b/src/tools/DECISIONS.md
index e19da2c..754b9b6 100644
--- a/src/tools/DECISIONS.md
+++ b/src/tools/DECISIONS.md
@@ -76,3 +76,13 @@ The invariant is asserted in `tests/search-timeout-hardening-tests.ts` (the `tim
 **Consequences.** Deadline expiry always surfaces as `deadline.hit`; the outer race runs `fetchCheapFallback` as designed. Merge order and dedup are unchanged.
 
 **Rollback.** Restore `if (budgetController.signal.aborted) break;` and inline the pressure check. No env or schema changes.
+
+## 2026-11-26 — Wayback API failure is retried, then rescued through CDX
+
+**Context.** `classifyWaybackAvailability` treated an HTTP 200 payload carrying `error: { code: "timeout" }` and empty `archived_snapshots` as a genuine miss. Popular URLs such as `https://www.yahoo.com` therefore failed `archive="only"` even though CDX returned a valid snapshot. The rescue also treated empty-extraction failures as non-hard, so a failed live render could not fall back to an archived page.
+
+**Decision.** Keep the availability API as the low-latency fast path. Classify error-bearing payloads as `api-error`, retry availability once on payload or transport failure, then query the SSRF-guarded CDX endpoint with `filter=statuscode:200&limit=1`. Preserve `no-snapshot` only for an error-free availability miss or an empty CDX result, preserve `snapshot-fetch-failed` for unusable snapshot bodies, and keep `deadline.hit` rescue-ineligible. Empty-extraction errors now count as hard failures.
+
+**Consequences.** Archived pages remain recoverable when the availability API times out. A failed rescue pays at most one extra availability request and one CDX request. Existing `archive.stale`, original-error rethrow, banner, cache, and deadline contracts remain unchanged.
+
+**Rollback.** Restore the prior classifier and `fetchWaybackOutcome` bodies and remove the empty-extraction branch from `isHardFailure`. The new regression checks then fail as the intended signal.
diff --git a/src/tools/README.md b/src/tools/README.md
index 01c5230..c80311e 100644
--- a/src/tools/README.md
+++ b/src/tools/README.md
@@ -24,6 +24,10 @@ A render that produces no usable text is an error, never a success body.
 - **Fallback:** markdown conversion retries once from the full DOM (`convertMarkdownWithRetry`) when the readability pass narrowed to an empty shell while the DOM still held text, and only then fails.
 - **Cache:** `pageCache` stores only content the guard already accepted; an empty body is never cached.
 
+## Wayback rescue contract (`fetch_web`)
+
+The availability API remains the fast path. An error-bearing payload or transport failure is `api-error`, not `no-snapshot`, and is retried once before the rescue queries CDX with `filter=statuscode:200&limit=1`. A genuine miss keeps `archive.stale` for `archive="only"` and the original live error for `archive="auto"`. `deadline.hit` is never rescued, while empty-extraction failures are eligible because the live render failed.
+
 ## Search budgets and the render queue (`search_web`)
 
 A search is a chain of renders, and every render goes through one serialized browser slot. Without an explicit bound on that chain, a "parallel" search degrades into a long serial queue and the caller sees a hang.
diff --git a/src/tools/fetchWeb.ts b/src/tools/fetchWeb.ts
index fc1dbd7..132c731 100644
--- a/src/tools/fetchWeb.ts
+++ b/src/tools/fetchWeb.ts
@@ -216,9 +216,12 @@ export interface WaybackOutcome {
  * snapshot download itself still happens in fetchWaybackSnapshot.
  */
 export function classifyWaybackAvailability(data: unknown): WaybackOutcomeKind {
-  const closest = (data as { archived_snapshots?: { closest?: { available: boolean; url: string } } })?.archived_snapshots?.closest;
-  if (!closest?.available || !closest.url) return "no-snapshot";
-  if (!closest.url.includes("web.archive.org")) return "no-snapshot";
+  const payload = (data as { archived_snapshots?: { closest?: { available: boolean; url: string } }; error?: unknown }) ?? {};
+  if (payload.error !== undefined && payload.error !== null) {
+    if (typeof payload.error === "object" || typeof payload.error === "string") return "api-error";
+  }
+  const closest = payload.archived_snapshots?.closest;
+  if (!closest?.available || typeof closest.url !== "string" || !closest.url.includes("web.archive.org")) return "no-snapshot";
   return "hit";
 }
 
@@ -232,47 +235,132 @@ export function classifySnapshotBody(htmlLength: number): WaybackOutcomeKind {
   return htmlLength >= 200 ? "hit" : "snapshot-fetch-failed";
 }
 
+/**
+ * Classify a Wayback CDX JSON payload without performing network I/O.
+ *
+ * A normal response contains a header row followed by at most one data row.
+ * An empty response is a genuine miss, while a malformed payload is an API
+ * failure that may be retried or surfaced as `api-error`.
+ */
+export function classifyCdxPayload(data: unknown): WaybackOutcomeKind {
+  if (!Array.isArray(data)) return "api-error";
+  if (data.length < 2) return "no-snapshot";
+  const row: unknown = (data as unknown[])[1];
+  if (!Array.isArray(row) || row.length < 2) return "api-error";
+  const timestamp = (row as unknown[])[0];
+  const original = (row as unknown[])[1];
+  if (typeof timestamp !== "string" || typeof original !== "string") return "api-error";
+  if (!/^\d{14}$/.test(timestamp)) return "api-error";
+  if (!original.startsWith("http://") && !original.startsWith("https://")) return "api-error";
+  return "hit";
+}
+
+/** Extract the timestamp and original URL from a valid CDX payload. */
+export function extractCdxSnapshot(data: unknown): { timestamp: string; original: string } | null {
+  if (classifyCdxPayload(data) !== "hit") return null;
+  const row = (data as unknown[][])[1] as [string, string];
+  return { timestamp: row[0], original: row[1] };
+}
+
+/** Download one archive snapshot and preserve the existing body-size gate. */
+async function fetchSnapshotByUrl(snapshotUrl: string, timestamp: string): Promise<WaybackSnapshot | null> {
+  try {
+    await assertSafeUrl(snapshotUrl);
+    const snapRes = await axios.get(snapshotUrl, {
+      timeout: 15000,
+      maxRedirects: 5,
+      responseType: "text",
+      maxContentLength: 5 * 1024 * 1024,
+      headers: { "User-Agent": "blowsh-mcp/2.3.2" },
+    });
+    const html = String(snapRes.data);
+    if (classifySnapshotBody(html.length) !== "hit") {
+      console.error(`[fetchWeb] Wayback: snapshot body too small for ${snapshotUrl}`);
+      return null;
+    }
+    return { html, timestamp, url: snapshotUrl };
+  } catch (e) {
+    console.error(`[fetchWeb] Wayback: snapshot fetch failed for ${snapshotUrl}: ${e instanceof Error ? e.message : String(e)}`);
+    return null;
+  }
+}
+
+/** Query CDX for one successful snapshot and download its raw archived body. */
+async function fetchCdxSnapshot(originalUrl: string): Promise<{ kind: WaybackOutcomeKind; snapshot?: WaybackSnapshot }> {
+  const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(originalUrl)}&output=json&limit=1&filter=statuscode:200&fl=timestamp,original`;
+  await assertSafeUrl(cdx);
+  const res = await axios.get(cdx, { timeout: 8000, maxRedirects: 3, responseType: "json" });
+  const kind = classifyCdxPayload(res.data);
+  if (kind !== "hit") return { kind };
+  const parsed = extractCdxSnapshot(res.data);
+  if (!parsed) return { kind: "api-error" };
+  const snapshotUrl = `https://web.archive.org/web/${parsed.timestamp}id_/${parsed.original}`;
+  const snapshot = await fetchSnapshotByUrl(snapshotUrl, parsed.timestamp);
+  if (!snapshot) return { kind: "snapshot-fetch-failed" };
+  return { kind: "hit", snapshot };
+}
+
 async function fetchWaybackSnapshot(originalUrl: string): Promise<WaybackSnapshot | null> {
   const outcome = await fetchWaybackOutcome(originalUrl);
   return outcome.snapshot ?? null;
 }
 
 async function fetchWaybackOutcome(originalUrl: string): Promise<WaybackOutcome> {
-  try {
-    // SSRF check for the Wayback API host (public, safe)
-    await assertSafeUrl("https://web.archive.org/");
-    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`;
+  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`;
+  const fetchAvailability = async (): Promise<{ kind: WaybackOutcomeKind; url?: string; timestamp?: string }> => {
+    await assertSafeUrl(api);
     const res = await axios.get(api, { timeout: 7000, maxRedirects: 3 });
-    const availability = classifyWaybackAvailability(res.data);
-    if (availability !== "hit") {
-      console.error(`[fetchWeb] Wayback: no snapshot available for ${originalUrl}`);
-      return { kind: "no-snapshot" };
-    }
+    const kind = classifyWaybackAvailability(res.data);
+    if (kind !== "hit") return { kind };
     const closest = (res.data as { archived_snapshots: { closest: { url: string; timestamp: string } } }).archived_snapshots.closest;
-    // Fetch the snapshot in a nested boundary: axios rejects non-2xx by
-    // default, so transport/HTTP failures here must map to
-    // "snapshot-fetch-failed", not the outer "api-error" (availability API).
-    const snapshotUrl: string = closest.url;
-    try {
-      const snapRes = await axios.get(snapshotUrl, {
-        timeout: 15000,
-        maxRedirects: 5,
-        responseType: "text",
-        maxContentLength: 5 * 1024 * 1024,
-        headers: { "User-Agent": "blowsh-mcp/2.3.2" },
-      });
-      const html = String(snapRes.data);
-      if (classifySnapshotBody(html.length) !== "hit") {
-        console.error(`[fetchWeb] Wayback: snapshot body too small for ${originalUrl}`);
-        return { kind: "snapshot-fetch-failed" };
-      }
-      return { kind: "hit", snapshot: { html, timestamp: closest.timestamp, url: snapshotUrl } };
-    } catch (e) {
-      console.error(`[fetchWeb] Wayback: snapshot fetch failed for ${originalUrl}: ${e instanceof Error ? e.message : String(e)}`);
-      return { kind: "snapshot-fetch-failed" };
+    return { kind, url: closest.url, timestamp: closest.timestamp };
+  };
+
+  let first: { kind: WaybackOutcomeKind; url?: string; timestamp?: string };
+  try {
+    first = await fetchAvailability();
+  } catch (e) {
+    console.error(`[fetchWeb] Wayback: availability api-error for ${originalUrl}: ${e instanceof Error ? e.message : String(e)}`);
+    first = { kind: "api-error" };
+  }
+
+  if (first.kind === "hit" && first.url) {
+    const snap = await fetchSnapshotByUrl(first.url, first.timestamp ?? "");
+    if (snap) return { kind: "hit", snapshot: snap };
+    return { kind: "snapshot-fetch-failed" };
+  }
+  if (first.kind === "no-snapshot") {
+    console.error(`[fetchWeb] Wayback: no snapshot available for ${originalUrl}`);
+    return { kind: "no-snapshot" };
+  }
+
+  console.error(`[fetchWeb] Wayback: availability api-error for ${originalUrl}, retrying once`);
+  let second: { kind: WaybackOutcomeKind; url?: string; timestamp?: string };
+  try {
+    second = await fetchAvailability();
+  } catch (e) {
+    console.error(`[fetchWeb] Wayback: api-error retry transport failed for ${originalUrl}: ${e instanceof Error ? e.message : String(e)}`);
+    second = { kind: "api-error" };
+  }
+
+  if (second.kind === "hit" && second.url) {
+    const snap = await fetchSnapshotByUrl(second.url, second.timestamp ?? "");
+    if (snap) return { kind: "hit", snapshot: snap };
+    return { kind: "snapshot-fetch-failed" };
+  }
+
+  try {
+    const cdx = await fetchCdxSnapshot(originalUrl);
+    if (cdx.kind === "hit" && cdx.snapshot) return { kind: "hit", snapshot: cdx.snapshot };
+    if (cdx.kind === "no-snapshot") {
+      console.error(`[fetchWeb] Wayback: no snapshot available for ${originalUrl} via CDX`);
+      return { kind: "no-snapshot" };
     }
+    if (cdx.kind === "snapshot-fetch-failed") return { kind: "snapshot-fetch-failed" };
+    console.error(`[fetchWeb] Wayback: CDX api-error for ${originalUrl}`);
+    return { kind: "api-error" };
   } catch (e) {
-    console.error(`[fetchWeb] Wayback: api-error for ${originalUrl}: ${e instanceof Error ? e.message : String(e)}`);
+    console.error(`[fetchWeb] Wayback: CDX api-error for ${originalUrl}: ${e instanceof Error ? e.message : String(e)}`);
     return { kind: "api-error" };
   }
 }
@@ -285,6 +373,8 @@ export function isHardFailure(e: unknown): boolean {
     if (msg.includes("404") || msg.includes("403") || msg.includes("paywall") || msg.includes("blocked") || msg.includes("failed with status")) return true;
     // network-ish failures are also hard: let archive try
     if (msg.includes("could not resolve") || msg.includes("timeout") || msg.includes("request failed")) return true;
+    // Empty extraction is a failed live render, so archive auto may rescue it.
+    if (e.code === EMPTY_EXTRACTION_CODE || msg.includes("empty extraction")) return true;
   }
   if (axios.isAxiosError(e) && e.response?.status !== undefined && e.response.status >= 400) return true;
   return false;
diff --git a/tests/task10-stress-fixes.ts b/tests/task10-stress-fixes.ts
index f79c20f..de693c7 100644
--- a/tests/task10-stress-fixes.ts
+++ b/tests/task10-stress-fixes.ts
@@ -2,7 +2,7 @@
 // Run: npx tsx tests/task10-stress-fixes.ts (no network, no Browsh needed)
 import assert from "node:assert";
 import { FetchError, createDeadlineError, isDeadlineHitError, DEADLINE_HIT_CODE } from "../src/errors.js";
-import { isHardFailure, classifyWaybackAvailability, classifySnapshotBody } from "../src/tools/fetchWeb.js";
+import { isHardFailure, classifyWaybackAvailability, classifySnapshotBody, classifyCdxPayload, extractCdxSnapshot } from "../src/tools/fetchWeb.js";
 import { isEmptyResultDeadline } from "../src/tools/searchWeb.js";
 import { fetchWebBatch } from "../src/tools/fetchWebBatch.js";
 
@@ -34,6 +34,12 @@ check("deadline.hit is NOT hard (no archive rescue, documented)", () => {
 check("generic Error is not hard", () => {
   assert.strictEqual(isHardFailure(new Error("boom")), false);
 });
+check("empty extraction message is hard so archive auto can rescue", () => {
+  assert.strictEqual(isHardFailure(new FetchError("empty extraction for https://x via render [dom 0 chars, text 0 chars]")), true);
+});
+check("empty extraction code is hard", () => {
+  assert.strictEqual(isHardFailure(new FetchError("empty extraction", { code: "empty.extraction" })), true);
+});
 
 // --- D2: Wayback availability classifier ---
 check("available snapshot is hit", () => {
@@ -122,5 +128,34 @@ check("SSRF-blocked items isolate per-URL (offline)", async () => {
   }
 });
 
+check("timeout payload with error object is api-error, not no-snapshot", () => {
+  assert.strictEqual(
+    classifyWaybackAvailability({ archived_snapshots: {}, error: { code: "timeout", message: "client timeout at 5.0 seconds" } }),
+    "api-error"
+  );
+});
+check("empty snapshots without error is no-snapshot", () => {
+  assert.strictEqual(classifyWaybackAvailability({ archived_snapshots: {} }), "no-snapshot");
+});
+check("empty snapshots with string error is api-error", () => {
+  assert.strictEqual(classifyWaybackAvailability({ archived_snapshots: {}, error: "timeout" }), "api-error");
+});
+check("valid CDX row is hit", () => {
+  const payload = [["timestamp", "original"], ["19961017235908", "http://www2.yahoo.com:80/"]];
+  assert.strictEqual(classifyCdxPayload(payload), "hit");
+  assert.deepStrictEqual(extractCdxSnapshot(payload), { timestamp: "19961017235908", original: "http://www2.yahoo.com:80/" });
+});
+check("empty CDX array is no-snapshot", () => {
+  assert.strictEqual(classifyCdxPayload([]), "no-snapshot");
+  assert.strictEqual(extractCdxSnapshot([]), null);
+});
+check("header-only CDX is no-snapshot", () => {
+  assert.strictEqual(classifyCdxPayload([["timestamp", "original"]]), "no-snapshot");
+});
+check("malformed CDX is api-error", () => {
+  assert.strictEqual(classifyCdxPayload({ bad: true }), "api-error");
+  assert.strictEqual(classifyCdxPayload([["timestamp", "original"], ["not-a-ts", 123]]), "api-error");
+});
+
 await Promise.all(pending);
 console.log(`\n${passed} checks passed`);
```
<!-- END_GIT_DIFF -->