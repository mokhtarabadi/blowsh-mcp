# Task 11: Blowsh docs and contract gaps (crawl focus, Instant Answer, architecture)

**File:** `tasks/qa/11-blowsh-docs-contract-gaps.md`
**Source:** manager
**Type:** improvement
**Status:** open

## Seat Check (Lite)

Domains: docs/contracts only → Software Architect (contract trigger). No UI, no flaky/race, no schema migration triggers → single-seat valid, no planning turn needed.

## Goal

Close five docs/contract gaps found in the 2026-09-17 audit: crawl focus seed exclusion, entity Instant Answer empty-URL result, stale CI/CD line in architecture, undocumented guard module, and unprioritized roadmap section 9.

## Manager's Notes

All items observed live or via discovery 2026-09-17. Crawl full with focus returned CharBudget + resume token correctly but skipped the seed itself as "focus filtered (no match)". Entity-intent search prepends a synthetic Instant Answer with url "" that counts toward max_results. docs/architecture.md section 6 lists both prebuilt-registry distribution and a stale "CI/CD: none currently" line. src/guard.ts has no duty entry in docs/architecture.md (only ssrf.ts/cache.ts documented). Roadmap section 9 (handles, adapters, browser actions, backpressure, SSRF allowlist) has no owner or priority. Decide each: doc fix, behavior fix, or explicit wont-fix with rationale.

<!-- These sections are unconditional per lint contract — DO NOT move back inside variants -->

## Local TODOs

- [x] Decide + document: should a focus-filtered crawl always fetch the seed? → NO: keep-and-explain (A1)
- [x] Decide + document: Instant Answer empty-URL result — keep-and-explain (Brain WONT-FIX)
- [x] Fix stale CI/CD line in docs/architecture.md section 6
- [x] Document src/guard.ts duty vs ssrf.ts (extension, not duplicate)
- [x] Prioritize roadmap section 9 items (owner + order + explicit deferral)
- [x] Verify functionality (docs build/lint where applicable)

## Acceptance Criteria

- [x] Crawl focus/seed behavior defined in docs and observed live
- [x] Instant Answer empty-URL behavior defined (consumers not surprised)
- [x] Architecture section 6 contradiction removed
- [x] guard.ts documented in architecture
- [x] Roadmap section 9 has priority/order or explicit deferral note

## Verification Evidence

- **Test command:** rtk test npm run build
- **Expected result:** exit 0; docs consistent; lint_task_file passes on this file
- **Actual result:** PASS — `rtk test npm run build` (tsc strict) completed with no errors after review-fix (roadmap owners + changelog note); docs-only change, no test surface affected
- **Exit code:** 0 (review-fix re-verified 2026-09-18)

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** Docs-only; near-zero runtime risk
- **Rollback plan:** Revert docs edits

---

## Execution Log & Reasoning

**[2026-09-17] [LITE] [EXECUTION-DETECTED]:** Docs-only task, no code or behavior change, no security/financial surface — full production line bypassed with justification logged here.

**[2026-09-17] [DECISION D1] [EXECUTION-DETECTED]:** D4 seed always fetched? NO — keep-and-explain.
- **Rationale:** Code (`crawlWeb.ts:625-630`) applies the content-level focus gate to every fetched page including the seed; always fetching the seed would change budget/char accounting and the `stop` semantics. Documenting current behavior is the safe contract fix.
- **Alternatives considered:** behavior change (seed exempt from focus filter).
- **Impact:** docs only; live behavior unchanged (audit already observed seed skip as `focus filtered (no match)`).

**[2026-09-17] [EXECUTION-DETECTED]:** Assumption A1: D5 already documented (`data_model.md` Instant Answer `url: ""`); added only the consumer MUST-accept note. Assumption A2: roadmap priority order is my proposal (security first, browser actions deferred) — Manager may reorder.

## Brain QA verdict (2026-09-18, same task_id)

**VERDICT: QA_PASSED.** No source files changed (docs+changelog only). D4 seed-gate and D5 empty-url claims match code. Contradiction removed. No tests needed for docs-only. Lite valid. Zero truncation this round.

**[2026-09-18] [REVIEW-FIX] [EXECUTION-DETECTED]:** Reviewer APPROVED_WITH_CHANGES (I1 medium): roadmap §9 lacked owners. Added stable role-based `Owner:` labels to all 5 items (Security and networking; MCP protocol and platform; Integrations; Browser runtime; Browser backend research). Priority order and browser-actions deferral preserved. CHANGELOG Unreleased entry extended (owners note). No source files changed; `docs/data_model.md` untouched per XML.

**[2026-09-18] [REVIEW-ACCEPT] [EXECUTION-DETECTED]:** Code Reviewer final acceptance — APPROVED + PO_REVIEW_PENDING. I1 resolved. No blocking issues, no further changes required. Awaiting Manager "Approved for closure".

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index fb5f1bc..3dce1b7 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -7,6 +7,7 @@
 - `fetch_web` **archive=auto silent Wayback miss** (Task 10 D2): `fetchWaybackSnapshot()` refactored into outcome-aware `fetchWaybackOutcome()` (`hit | no-snapshot | snapshot-fetch-failed | api-error`) with a stderr log line per miss class, so "attempted but empty" is distinguishable from "never tried"; pure `classifyWaybackAvailability()` exported for tests. Original error still rethrown unchanged when no snapshot rescues; `deadline.hit` documented as rescue-ineligible (`isHardFailure()` stays false). Tool description now lists timeout/network as hard failures (matches code + `data_model.md`).
 - `fetch_web_batch` **timeout contract** (Task 10 D1): render transport timeouts now carry an explicit transient-retry hint (`transient render timeout after Nms; retry this URL alone or in a smaller batch`) with URL attribution; per-item `deadline_ms` budget supported (bounds each item so one slow URL fails fast instead of stalling the batch); tool description documents that other single-fetch options stay unsupported in batch. Verified: axios timeout starts after mutex acquisition (no lock change — timer already measures the render, not the wait); batch per-URL isolation preserved.
 - Docs: internal task label removed from the deadline precedence note in `docs/data_model.md` (task-number discipline for prompt-facing docs).
+- Docs/contracts: `crawl_web` `focus` documents that the seed is filtered like any page (non-matching seed skipped as `focus filtered (no match)`); `search_web` documents that the synthetic Instant Answer result carries `url: ""` which consumers must accept; `docs/architecture.md` contradiction removed (stale `CI/CD: none currently` line), `src/guard.ts` duty documented in §3.4 (extends `ssrf.ts`, not a duplicate), and §9 roadmap prioritized (SSRF allowlist first, browser actions explicitly deferred) with role-based owners per item.
 
 ### Added
 - Browsh hardening (Task 08): persistent Firefox profile via `BROWSH_PROFILE_DIR` (default `/data/browsh-profile`, HOME-redirection for the Browsh child; Dockerfile declares `VOLUME`; corrupt profile quarantined to `<dir>.corrupt-<ts>` with one fresh-boot retry), boot-time `prewarm()` (brings the browser up at server start; the first fetch awaits it via `awaitWarmup()` instead of racing it; `BROWSH_PREWARM=0` disables), terminal dims `BROWSH_COLS`/`BROWSH_ROWS` (160x60) passed as `COLUMNS`/`LINES`, `TZ=UTC`, and spawn telemetry on stderr. Verified live: volume holds real profile (`cookies.sqlite`, `cert9.db`), second boot reuses it, `prewarm complete` in logs.
diff --git a/docs/architecture.md b/docs/architecture.md
index bcf139c..2d0ed14 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -14,6 +14,7 @@ blowsh-mcp/
 │   ├── cache.ts                    # TTL in-memory cache shared by all fetch tools
 │   ├── extract.ts                  # Main-content extraction, selector helpers, truncation + BM25 focus, toc/section, must_contain, stitch
 │   ├── errors.ts                   # FetchError + message formatting
+│   ├── guard.ts                    # Bot-guard detection (Cloudflare/Turnstile/reCAPTCHA) + per-host verdict cache + fetch logging
 │   └── tools/
 │       ├── fetchWeb.ts             # fetch_web: plain/html/markdown/pdf + selector/max_chars/wait_ms + focus/toc/section/must_contain/archive/stitch
 │       ├── extractPdf.ts           # type: pdf — SSRF-guarded download → pdftotext (size-capped)
@@ -79,6 +80,7 @@ blowsh-mcp/
 
 - `assertSafeUrl(url)`: DNS-resolves hostname; rejects loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16), reserved, IPv4-mapped IPv6, `localhost`. Disable via `ALLOW_PRIVATE_URLS=true`.
 - `pageCache`: in-memory TTL map (default 5 min, `CACHE_TTL_MS`).
+- `guard.ts` (bot-guard detection — extends, not duplicates, `ssrf.ts`): `detectGuard(content)` classifies page text into `GuardKind` (`captcha`, `rate-limit`, `ip-block`, `browser-check`, `consent-wall`, …); per-host verdict cache (1h TTL, 1000-entry cap); one JSON stderr line per fetch (host + guard status + duration, `GUARD_DETECT=0` kill-switch); additive HTML-comment trailer on guarded HTML only.
 
 ## 4. Data Stores
 
@@ -99,7 +101,6 @@ blowsh-mcp/
 - **Distribution:** Prebuilt image on GitHub Container Registry — `ghcr.io/mokhtarabadi/blowsh-mcp:latest` (also tagged `2.3.2`, branch, semver, and `sha-<sha>`). Pull with `docker pull ghcr.io/mokhtarabadi/blowsh-mcp:latest`.
 - **CI/CD:** GitHub Actions (`.github/workflows/docker-publish.yml`) builds the Dockerfile and pushes to ghcr on `main` pushes and `v*` tags, with a container smoke test (MCP initialize → tools/list) before the run completes.
 - **Form factor:** MCP server over stdio (no listening port). The Browsh HTTP port stays container-private.
-- **CI/CD:** none currently; verify with build + `docker build` + JSON-RPC smoke test.
 
 ## 7. Security Considerations
 
@@ -115,9 +116,12 @@ blowsh-mcp/
 
 ## 9. Future Considerations / Roadmap
 
-- ~~Search pagination beyond page 10 / query-variant automation.~~ **Done in v2.3.0** (query_variants + 4-engine consensus).
-- Reference handles (L/S) for token economy; progressToken streaming; full page memory fingerprint diff (`since_last` is naive hash, not section-level diff).
-- Domain intelligence adapters (Reddit, npm/PyPI/crates, StackOverflow) — v2.3.0 has minimal verticals only.
-- Browser actions (click/type/press/wait_selector/wait_text) — not yet (Browsh HTTP mode limited vs DonSeTch ghost).
-- Multi-tab backpressure / tab-recycling after long sessions.
-- SSRF allowlist enrichment (public suffix validation, blocked TLD lists).
\ No newline at end of file
+Prioritized (highest value / lowest risk first; deferred items marked as such):
+
+1. **SSRF allowlist enrichment** (security first: public-suffix validation, blocked TLD lists). **Owner:** Security and networking.
+2. **Reference handles (L/S) + progressToken streaming; section-level fingerprint diff** (`since_last` is naive whole-page hash only). **Owner:** MCP protocol and platform.
+3. **Domain intelligence adapters** (Reddit, npm/PyPI/crates, StackOverflow) — only minimal verticals now. **Owner:** Integrations.
+4. **Multi-tab backpressure / tab-recycling** after long sessions. **Owner:** Browser runtime.
+5. **Browser actions** (click/type/press/wait_selector/wait_text) — **deferred**: Browsh 1.8.0 HTTP mode cannot drive page interaction (vs DonSeTch ghost); needs a different browser backend. **Owner:** Browser backend research.
+
+- ~~Search pagination beyond page 10 / query-variant automation.~~ **Done in v2.3.0** (query_variants + 4-engine consensus).
\ No newline at end of file
diff --git a/docs/data_model.md b/docs/data_model.md
index ea15079..18ac0f1 100644
--- a/docs/data_model.md
+++ b/docs/data_model.md
@@ -81,7 +81,8 @@ Notes: `page` synthesizes engine-specific offsets (DDG 20/page, Bing/Brave/Mojee
 
 Each result carries `fetched_at` (UTC epoch milliseconds, per `docs/conventions.md`)
 so consumers can assess staleness. The synthetic Instant Answer result uses the
-same field. Engines are rendered concurrently and merged by consensus; an empty organic result set is
+same field with `url: ""` — consumers MUST accept an empty `url` (it still counts
+toward `max_results`). Engines are rendered concurrently and merged by consensus; an empty organic result set is
 terminal success `[]`. Query cache (intent-aware TTL) dedups repeats.
 
 ### 3. `crawl_web`
@@ -92,7 +93,7 @@ terminal success `[]`. Query cache (intent-aware TTL) dedups repeats.
 |------------------|-----------|----------|-------------|
 | `url`            | string    | yes      | http(s) seed, SSRF-guarded |
 | `mode`           | `"full"|"map"|"content"` | no | default full (sitemap map + content) |
-| `focus`          | string    | no       | BM25-lite topic — ranks frontier and filters pages |
+| `focus`          | string    | no       | BM25-lite topic — ranks frontier and filters pages (seed included: a non-matching seed is skipped as `focus filtered (no match)`) |
 | `max_pages`      | integer   | no       | 1..200, default 10 |
 | `max_depth`      | integer   | no       | 0..10, default 2 (0=seed only) |
 | `max_total_chars`| integer   | no       | 4000..500_000, default 60_000 |
```
<!-- END_GIT_DIFF -->
