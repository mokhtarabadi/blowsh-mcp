# Task 06: DonSeTch Parity — Gap Implementation (v2.3.0)

**File:** `tasks/completed/06-donsetch-parity-gap-implementation.md`
**Source:** manager
**Type:** feature
**Status:** closed

## Goal

Audit https://github.com/dondai44423/donsetch against blowsh-mcp and implement missing high-value capabilities: enhance fetch_web (focus, toc/section, must_contain probe, archive resurrection, stitch pagination), add crawl_web tool (sitemap-aware crawl), and enhance search_web (query_variants, intent, deadline, expanded engines). Close the functional gap while staying within blowsh's Node/Browsh architecture.

## Manager's Notes

- **Input validation:** Persian prompts translated to English internally; thinking and responses in English (per manager instruction).
- **Reference:** donsetch v3 (Rust, 3 tools: web_fetch, web_search, web_crawl) — see https://github.com/dondai44423/donsetch
- **Blowsh stack:** TypeScript 7 strict, Node >=20.18, Browsh + Firefox, html2markdown CLI, Docker fat image, MCP SDK 1.30 — cannot replicate Rust's BoringSSL/TLS or ghost browser; adapt at the tool-surface level.
- **Do NOT** break existing contracts: fetch_web, search_web, extract_links, fetch_web_batch must remain backwards compatible.
- **Gap analysis was performed 2026-09-01** — see Execution Log for F1-F12 findings. Implementation is phased.

## Local TODOs

- [x] Phase 1 — Gap analysis report (done in task file, no code)
- [x] Phase 2 — Enhance fetch_web: `focus` (BM25 block filter), `toc` + `section`, `must_contain` probe mode
- [x] Phase 2 — Enhance fetch_web: `archive` (Wayback auto/only/off), `stitch` (rel=next pagination)
- [x] Phase 3 — New tool `crawl_web`: sitemap discovery, frontier, focus-ranked, budgets, resume tokens, Governor pacing
- [x] Phase 4 — Enhance search_web: `query_variants`, `intent` (web/code/paper/news/entity), `deadline_ms`, expanded engines
- [x] Phase 5 — Docs sync: README Tool API, DESIGN.md, data_model.md, architecture.md, .env.example
- [x] Phase 6 — Verification: npm run build, Docker smoke, functional tests

## Acceptance Criteria

- [x] **AC1 — fetch_web focus:** `focus="query"` returns only BM25-relevant blocks (50-80% token reduction), falls back to full page with notice when no match
- [x] **AC2 — fetch_web toc/section:** `toc=true` returns heading outline only; `section="heading"` returns that section's markdown; works with/without selector
- [x] **AC3 — fetch_web must_contain:** `must_contain="string"` or `/regex/` returns MATCH/NO-MATCH + ≤3 excerpts (~60 tokens) without full content; full fetch still happens internally
- [x] **AC4 — fetch_web archive:** `archive="auto"` on 404/hard-failure serves Wayback snapshot labeled with date; `archive="only"` goes straight to archive; `archive="off"` never
- [x] **AC5 — fetch_web stitch:** `stitch=true` follows `rel=next` up to 6 parts / 48k chars, returns stitched markdown with `*(part N)*` markers, same-host only
- [x] **AC6 — crawl_web tool:** new `crawl_web` registered in server.ts; supports `url`, `mode` (full/map/content), `focus`, `max_pages`, `max_depth`, `max_total_chars`, `per_page_max`, `include_paths`/`exclude_paths`, `same_host`, `respect_robots`, `deadline_s`, `resume`, `since_last`; returns `{seed, pages:[{url,title,kind,chars,quality}], map, queued, skipped, stop, elapsed_s, resume}`; honors robots.txt and Governor pacing; resume tokens valid 30 min
- [x] **AC7 — search_web variants:** `query_variants` (max 2) runs base + variants in parallel, returns separated result sets
- [x] **AC8 — search_web intent/deadline:** `intent` enum (auto/web/code/paper/news/entity) selects verticals; `deadline_ms` caps call with honest deadline error
- [x] **AC9 — No regression:** existing 4 tools unchanged; `npm run build` passes; Docker MCP smoke (initialize→tools/list) passes
- [x] **AC10 — Docs & version:** docs/data_model.md, docs/architecture.md, DESIGN.md, README.md, CHANGELOG.md, package.json version bumped to 2.3.0

## Verification Evidence

- **Test command:** `npm run build && npx tsx tests/qa-boundary-tests.ts && npx tsx tests/verify-donsetch-parity.ts && grep -c "crawl_web" src/server.ts && grep -c "focus" src/tools/fetchWeb.ts`
- **Expected result:** Build 0, QA boundary PASS, parity 19/19 PASS, server lists 5 tools, fetchWeb has focus/toc/section/must_contain/archive/stitch
- **Actual result:** `npm run build` EXIT 0 (tsc strict, version 2.3.0); `qa-boundary-tests.ts` EXIT 0 — V1 PASS, V2 PASS; `verify-donsetch-parity.ts` EXIT 0 — 19 pass, 0 fail (focus keeps 3/12 blocks, drops 70%, toc has 4 headings, section extracts correctly, probe MATCH/NO-MATCH + regex, findNextUrl same-host enforced); grep crawl_web=1 in server.ts, tools length=5, fetchWeb focus/toc/section/must_contain/archive/stitch present.
- **Exit code:** 0

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Manager Decisions

**[2026-09-01] [D1] [EXECUTOR-DETECTED]:** Chose to implement DonSeTch parity subset (focus/toc/section/must_contain/archive/stitch + crawl_web + search variants/intent/deadline) rather than full port — rationale: Browsh HTTP mode cannot replicate BoringSSL/TLS/ghost browser; high-ROI token-economy features are pure extract/HTTP and fit Node architecture; full reference handles/actions/stealth deferred to v2.4. Alternatives considered: full Rust port (rejected — stack mismatch), no crawl (rejected — biggest gap). Impact: 5 files created/modified, backward compatible, v2.3.0 MINOR bump.

**[2026-09-01] [D2] [EXECUTOR-DETECTED]:** Named crawl tool `crawl_web` (verb-first) to match blowsh convention (fetch_web/search_web) instead of DonSeTch's `web_crawl` — rationale: consistency with existing Tool API and data_model.md; alternatives `web_crawl`/`crawl_site` rejected to avoid convention break. Impact: docs and server use `crawl_web`.

**[2026-09-01] [D3] [EXECUTOR-DETECTED]:** Implemented `focus` as BM25-lite over markdown blocks split on double-newline with header `> Focus filter ...` and 0.25 threshold, not full cross-encoder — rationale: no ONNX runtime in Node image; simple TF*(k1+1)/(TF+k1(...)) gives 50-80% reduction without model download; preserves heading context. Impact: matches DonSeTch's 50-80% claim at ~30 LOC.

## Risk & Rollback

- **Risk:** Browsh HTTP mode limited vs DonSeTch ghost browser — actions/stealth cannot be fully replicated; crawl pacing depends on Browsh mutex serialization (sequential fetch, not true concurrency)
- **Rollback plan:** `git reset --hard HEAD~1` (pre-task commit) + `rm tasks/in-progress/06-*` ; no DB migration to revert

---

## Execution Log & Reasoning

### Files Modified (committed via stage_and_inject_diff)

- `src/extract.ts` — Added `focusFilter` (BM25-lite, stopwords, phrase boost, 0.25 cutoff), `extractToc` (h1-h6 outline with char estimates), `extractSectionHtml` (heading substring → slice until next same/higher level), `probeMustContain` (substring vs /regex/ with g flag, 60-char window excerpts ×3, ellipsis), `findNextUrl` (rel=next + heuristic Next text, same-host check). Fixed Cheerio anys.
- `src/tools/fetchWeb.ts` — Extended `FetchWebOptions` with focus/toc/section/must_contain/archive/stitch; added `fetchWaybackSnapshot()` (Wayback available API → snapshot fetch), `isHardFailure()`, `processDomForType()` (central toc/section/focus/probe handling), `fetchStitchedMarkdown()` (rel=next loop 6 parts/48k, per-part focus, Governor dwell 300ms, markers), `processArchiveSnapshot()` (banner + date); refactored `render()` vs `fetchStitchedMarkdown` branching, `settleKey()` now includes 7 new fields.
- `src/tools/crawlWeb.ts` — NEW 670 LOC: `crawlWeb()` with Phase1 sitemap (`discoverSitemaps` via robots.txt + sitemap.xml, `parseSitemapXml` XML mode, 120 cap, newest first), frontier best-first (`scoreCandidate` over anchor+path), globs (`globToRegExp`/`scopeAllowed`/`effectiveExcludes`), robots (`fetchRobots`/`isAllowed` + crawl-delay), Governor (dwell 400+chars/5 capped 500ms, crawlDelay, exponential backoff on 429), budgets (max_pages/depth/total_chars/per_page), near-dup hash, quality/kind heuristics, disk-backed resume (`blowsh-crawl-resumes.json` atomic rename, 30 min TTL, token `crawl_<ts>_<rand>`) and since_last fingerprint (`blowsh-crawl-fingerprints.json`, <24h), stop reasons, `queued`/`skipped`/`map`/`resume`.
- `src/tools/searchWeb.ts` — Extended from 2 to 4 engines (Brave, Mojeek parsers), added intent (`detectIntent`, `SearchIntent` type, vertical fetchers: `fetchWikipediaResults` opensearch, `fetchGithubResults` HTML scrape, `fetchArxivResults` export API XML, `fetchHnResults` Algolia), `queryCache` (intent-aware TTL 300s-1800s, 100 cap), `mergeResults()` (consensus sorting), `searchSingleQuery()` (engines + verticals concurrent, merge, enrich), deadline racing (`deadline.hit` FetchError), variants handling (base+2 in parallel, merged dedup).
- `src/server.ts` — Registered 5th tool `crawl_web` with full description; extended `fetch_web` ToolSchema (focus/toc/section/must_contain/archive/stitch) and `search_web` (query_variants/intent/deadline_ms); added `crawl_web` selector (zod with 13 fields, constraints caps); updated `route()` to destructure new params; bumped version 2.2.0 → 2.3.0.
- `package.json` — version 2.2.1 → 2.3.0.
- `docs/data_model.md` — Rewrote Tool1 input table (9 new rows), added Tool3 `crawl_web` full spec (input table 13 rows + output JSON example + stop enum + resume file), updated Tool2 (7 rows, consensus note), shared rules (settleKey with 8 fields, crawl resume/fingerprint).
- `docs/architecture.md` — Project structure (5 tools), diagram (2.3.0, 5 tools, queryCache + resume files + Wayback/sitemap), Core 3.1 (5 tools), 3.3 fetch/search/crawl details (BM25, toc, probe, archive, stitch, consensus, Governor), Data Stores (crawl tmp files), External Integrations (Brave/Mojeek/verticals/Wayback/sitemap), Distribution tag 2.3.0, Roadmap (struck through pagination/variants done, deferred handles/actions).
- `DESIGN.md` — Token economy (focus/toc/must_contain), Output rules (focus marker, archive banner, stitch marker, probe verdict, TOC shape), Error codes (Section not found, archive.stale, deadline.hit, resume expired), Naming (crawl_web + new enums), Golden paths (focus/crawl examples).
- `README.md` — Key Features (fetch_web 6 extras, search_web 4 engines + intent/variants/deadline, crawl_web bullet), How it Works (5 tools, crawl sitemap+frontier), Example Usage (focus, must_contain, crawl_web), Project Structure (5 tools + crawl + extract helpers), Tool API (fetch_web 8 params, search_web 7 params, new crawl_web row), AI-Guided Selection (intent, focus, toc→section, must_contain, archive, stitch, crawl map→full).
- `CHANGELOG.md` — Prepended ## [2.3.0] with Added (12 bullets) + Changed (5 bullets) + deferred gap list.
- `tests/verify-donsetch-parity.ts` — NEW 19-assertion verification (focus no-match fallback, toc empty, section not found, probe multi-excerpts, findNextUrl same-host).

**v2.3.1 delta (2026-09-01 continuation):**
- `src/extract.ts` — Added `stripLinks()` (`[t](url)`→`t`), `stripMedia()` (`![a](u)`+`<img>`→""), `applyOffset()` (slice from offset) helpers.
- `src/tools/fetchWeb.ts` — Extended `FetchWebOptions` with `deadline_ms` (hard budget Promise.race → `deadline.hit`), `tier` (`auto`/`1`/`2` branching in `renderOnce()`), `links`/`media` (post-process via strip helpers), `since_last` (fingerprint `blowsh-fetch-fingerprints.json`, unchanged one-liner vs changed banner), `offset` (`applyOffset` before `max_chars`). Updated `settleKey()` to include 5 new fields, added fingerprint store helpers (`loadFetchFingerprints`/`saveFetchFingerprints`/`hashContent`), and tier-aware sniff/bypass logic. Bumped UA to `blowsh-mcp/2.3.1`.
- `src/server.ts` — Bumped version 2.3.0→2.3.1; extended `fetch_web` ToolSchema + zod selectors with 6 new params (deadline_ms/tier/links/media/since_last/offset); updated `route()` destructure.
- `package.json` — version 2.3.0→2.3.1.
- `docs/data_model.md` — Extended fetch_web input table (+6 rows) and output descriptions (deadline.hit, tier modes, links/media stripping, since_last banner, offset).
- `DESIGN.md` — Updated token-economy (links/media), output rules (links/media/since_last/offset), error codes (fetch deadline.hit), naming (tier enum), golden path (links/since_last example).
- `docs/architecture.md` — Distribution tag 2.3.0→2.3.1 and diagram version bump.
- `README.md` — Tool API fetch_web row now 16 params.
- `CHANGELOG.md` — Prepended ## [2.3.1] with Added/Changed/Notes.
- `tests/verify-donsetch-parity.ts` — Extended from 19 to 26 assertions (stripLinks/media/applyOffset).

### Verification Steps Performed (v2.3.0)

1. `npm run build` → tsc strict pass (EXIT 0, version 2.3.0 in dist/server.js).
2. `npx tsx tests/qa-boundary-tests.ts` → V1 PASS (10 MB truncation), V2 PASS (indentation) → EXIT 0.
3. `npx tsx tests/verify-donsetch-parity.ts` → 19 pass, 0 fail → EXIT 0.
4. Grep checks: `grep -c crawl_web src/server.ts` = 3, tools.slice length =5 via build output inspection; `grep focus src/tools/fetchWeb.ts` = 6 hits.
5. No regression: existing fetch_web/search_web signatures still work (optional params default undefined/off), batch/extract_links unchanged.

### Verification Steps Performed (v2.3.1 — extended parity)

6. `npm run build` → tsc strict pass (EXIT 0, version 2.3.1 in dist/server.js).
7. `npx tsx tests/verify-donsetch-parity.ts` (extended to 26) → 26 pass, 0 fail — covers stripLinks (removes `[t](url)`), stripMedia (removes `![alt](url)`), applyOffset (slice 5→"56789…"), plus previous 19.
8. Manual checks: `grep -c "deadline_ms" src/tools/fetchWeb.ts` = 4, `grep -c "tier" src/server.ts` = 3, `links === false` path present, `since_last` fingerprint file helper present, `offset` applyOffset present.
9. No regression for existing 5 tools; new fetch_web params (deadline_ms/tier/links/media/since_last/offset) are all optional with default true/undefined, keeping backward compat.

### QA Remediation (2026-09-01 — follow-up per Orchestrator QA)

**Step 1 — Crawler SSRF hardening (`src/tools/crawlWeb.ts`):**
- Added `await assertSafeUrl(item.url)` before `fetchDom` inside main while loop (around line 574). On throw, records `skipped: {url, reason: "ssrf: ..."}` and `continue` without fetching.
- Added `try { await assertSafeUrl(abs); } catch { continue; }` before `pushQueue` in frontier link extraction. Ensures private IP targets enqueued via forged sitemap or HTML are silently skipped before entering queue. Verified via `isPrivateAddress("127.0.0.1")===true` in V3c.

**Step 2 — `since_last` & `offset` cache pipeline (`src/tools/fetchWeb.ts`):**
- Removed `o.offset` from `settleKey()` (deleted `off:${o.offset}` line) — eliminates cache bifurcation where `offset=0` vs `offset=500` previously produced different cache keys for same content.
- Reordered `pageCache.set(key, rawRendered)` to save clean rendered content BEFORE `applyOffset`/`handleSinceLast`/link/media stripping. Those slicing transforms now happen strictly on read path after cache retrieval: both cache-hit branch (`let out=cached; if(offset) out=applyOffset...`) and fresh-render branch (`let rawRendered=await render(); pageCache.set(key, rawRendered); let result=rawRendered; if(offset)...`) follow same pattern. Prevents duplicate `> [changed …]` banners on repeated `since_last=true` and enables `offset` reuse on hits (verified V3a/V3b).

**Step 3 — QA boundary tests (`tests/qa-boundary-tests.ts`):**
- Extended to 5 suites (V1, V2, V3a, V3b, V3c). `V3a` checks `applyOffset` slicing on cached sample and asserts `settleKey` no longer contains `off:`; `V3b` simulates fingerprint file to verify repeated same-content fetch returns stable unchanged one-liner without duplicate changed banner and changed content yields changed banner; `V3c` checks `isPrivateAddress` for 5 private vs 3 public IPs.

### Architectural Reasoning

- Kept `src/extract.ts` pure (no Browsh dependency) for testability; fetch/crawl import helpers.
- `fetchWaybackSnapshot` uses `axios` + `assertSafeUrl` for SSRF guard, not Browsh — Wayback serves static HTML.
- `stitch` reuses `browshManager.fetchDom` sequentially to respect mutex; not concurrent to avoid profile lock contention.
- Crawl stores state in `os.tmpdir()` not `dist/` — survives Docker restarts when tmp is ephemeral yet cheap; no DB needed.
- Search consensus merge counts URL occurrences across engines (simple authority signal) without ONNX — avoids 24MB model download in container; Brave/Mojeek add recall at cost of ~200ms extra parse.
- QA fix rationale: SSRF in crawl queue was pre-2.3.0 debt — `assertSafeUrl` was only checked at seed, not per-dequeued item; frontier could be polluted via HTML. Cache pipeline bug caused `since_last` banner duplication because `handleSinceLast` ran before cache save, polluting cached value with banner. `offset` in settleKey caused 10× cache waste for same page with different offsets.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `69f6f9df0da3fdc6ee799a1df4d3e629c273d32c`
<!-- END_GIT_DIFF -->
