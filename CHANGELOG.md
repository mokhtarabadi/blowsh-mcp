# Changelog

## [2.4.0] - 2026-09-18

### Fixed
- `search_web` **deadline expiry returning bare `[]`** (Task 10 D3): an empty engine merge under a fired global deadline now throws the typed `deadline.hit` error (shared `createDeadlineError()` helper, stable code `deadline.hit`) so the outer race runs the cheap browser-free fallback (partials) instead of resolving an empty list indistinguishable from genuine no-results; per-query `deadline.hit` propagates through `query_variants` instead of being swallowed by `.catch(() => [])`. Precedence rule documented in `docs/data_model.md`. 18 checks pass (`tests/task10-stress-fixes.ts`).
- `fetch_web` **archive=auto silent Wayback miss** (Task 10 D2): `fetchWaybackSnapshot()` refactored into outcome-aware `fetchWaybackOutcome()` (`hit | no-snapshot | snapshot-fetch-failed | api-error`) with a stderr log line per miss class, so "attempted but empty" is distinguishable from "never tried"; pure `classifyWaybackAvailability()` exported for tests. Original error still rethrown unchanged when no snapshot rescues; `deadline.hit` documented as rescue-ineligible (`isHardFailure()` stays false). Tool description now lists timeout/network as hard failures (matches code + `data_model.md`).
- `fetch_web_batch` **timeout contract** (Task 10 D1): render transport timeouts now carry an explicit transient-retry hint (`transient render timeout after Nms; retry this URL alone or in a smaller batch`) with URL attribution; per-item `deadline_ms` budget supported (bounds each item so one slow URL fails fast instead of stalling the batch); tool description documents that other single-fetch options stay unsupported in batch. Verified: axios timeout starts after mutex acquisition (no lock change — timer already measures the render, not the wait); batch per-URL isolation preserved.
- Docs: internal task label removed from the deadline precedence note in `docs/data_model.md` (task-number discipline for prompt-facing docs).
- Docs/contracts: `crawl_web` `focus` documents that the seed is filtered like any page (non-matching seed skipped as `focus filtered (no match)`); `search_web` documents that the synthetic Instant Answer result carries `url: ""` which consumers must accept; `docs/architecture.md` contradiction removed (stale `CI/CD: none currently` line), `src/guard.ts` duty documented in §3.4 (extends `ssrf.ts`, not a duplicate), and §9 roadmap prioritized (SSRF allowlist first, browser actions explicitly deferred) with role-based owners per item.

### Added
- Browsh hardening (Task 08): persistent Firefox profile via `BROWSH_PROFILE_DIR` (default `/data/browsh-profile`, HOME-redirection for the Browsh child; Dockerfile declares `VOLUME`; corrupt profile quarantined to `<dir>.corrupt-<ts>` with one fresh-boot retry), boot-time `prewarm()` (brings the browser up at server start; the first fetch awaits it via `awaitWarmup()` instead of racing it; `BROWSH_PREWARM=0` disables), terminal dims `BROWSH_COLS`/`BROWSH_ROWS` (160x60) passed as `COLUMNS`/`LINES`, `TZ=UTC`, and spawn telemetry on stderr. Verified live: volume holds real profile (`cookies.sqlite`, `cert9.db`), second boot reuses it, `prewarm complete` in logs.
- Bot-guard detection + logging (Task 08, new `src/guard.ts`): strong-marker → immediate kind (`captcha`, `rate-limit`, `ip-block`, `browser-check`, `consent-wall`...), weak rule now (≥2 weak + structural signal `<form`/`<iframe`/`type=password`/`data-sitekey`) OR ≥3 weak (fewer blog-post false positives), 1h `TtlCache` verdict cache capped at 1000 entries (`cacheGuardVerdict()`, LRU via `deleteOldest`), one JSON stderr line per fetch (`event:fetch` + host + guard status + duration; `GUARD_DETECT=0` kill-switch), additive HTML-comment trailer on guarded HTML only (non-HTML guarded hits return bytes unchanged). 20 unit checks pass (`tests/guard-detector-tests.ts`).
- `.env.example`: documents `BROWSH_PROFILE_DIR`, `BROWSH_COLS`, `BROWSH_ROWS`, `BROWSH_PREWARM`, `BROWSH_RECYCLE_REQUESTS`, `GUARD_DETECT`, `GUARD_CACHE_TTL_MS`.
- QA hotfix (Task 08): `quarantineProfileDir` default-deny allowlist (only under `/data` or OS TMP, never the roots, depth ≥3 — refuses with loud log instead of risking host paths); `BROWSH_COLS/ROWS` clamped (80–250/24–100, fallback 160x60 + warning); boot logs `fresh profile dir` vs `reusing profile (N entries)`. Verified live: corrupt-profile recovery (EEXIST → quarantine → fresh boot → `prewarm complete`); width A/B stayed unproven (Browsh fresh-startup flake under load, host egress fine) — A3 unchecked with caveat.

## [2.3.2] - 2026-09-12

### Fixed
- `fetch_web` **section** empty body (Task 07 P1): `extractSectionHtml()` now normalizes heading text (edit-link anchors stripped), hoists wrapped headings (`div.mw-heading > h2 + span.mw-editsection`) via `hoistHeading()`, skips edit spans during collection, and falls back to a document-order walk when content is not a flat sibling of the heading. `extractToc()` char estimates use the same collector. Verified live: `Experimental progress` section went from 153 chars (heading only) to real body text.
- `search_web` **news/entity empty on long queries** (Task 07 P2): empty-only fallback — original vertical runs first; only when merged results are empty, retry once with `simplifyQuery()` (strips quotes, `site:`, AND/OR/NOT, +/- prefixes), then once as plain `web` intent. Non-empty first passes untouched (simple-query baseline cannot regress).
- `search_web` **deadline.hit with zero data** (Task 07 P3): on outer deadline with no results, a cheap browser-free fallback (plain-HTTP DDG-html + Mojeek parse) returns partial results instead of a bare error; original `deadline.hit` thrown only when fallback is also empty. Verified live: 3s deadline returned 5 ranked partials (server log `returning 5 cheap-fallback partial results`).
- `search_web` **paper relevance** (Task 07 P4): arXiv vertical drops withdrawn/retracted entries (`/\bwithdrawn\b|\bretract(?:ed|ion)?s?\b/i` word-boundary on title+summary — keeps legitimate "Retractable" titles), fetches 10 candidates, and re-ranks by title-phrase > title-token > summary-phrase scoring. Verified live: zero withdrawn matches, title-matched papers on top.

## [2.3.1] - 2026-09-01

### Added
- `fetch_web`: **deadline_ms** (hard budget 500-600000ms → `FetchError: deadline.hit: fetch timed out ...` with stable code `"deadline.hit"`; Promise.race inside `fetchWeb()`).
- `fetch_web`: **tier** (`auto|1|2` — `auto` HTTP first → browser escalate (default), `1` HTTP-only direct axios, `2` browser-direct skip sniff; handled in `renderOnce()` via `tierMode`).
- `fetch_web`: **links** (`links=false` strips `[text](url)` → `text` via `stripLinks()` — saves ~30%; default true for backward compat) and **media** (`media=false` strips `![alt](url)` and `<img>` via `stripMedia()`).
- `fetch_web`: **since_last** (`since_last=true` fingerprint check via `blowsh-fetch-fingerprints.json` — unchanged → `unchanged since last fetch (fingerprint age)` one-liner ~30 tokens; changed → `> [changed since last fetch — …]` banner; SHA256 hash, 200-entry prune).
- `fetch_web`: **offset** (`offset=N` skips N chars before `max_chars` truncation via `applyOffset()` — parity with DonSeTch `next_offset` resume; `settleKey` now includes `off:N` + `dl:N`).
- `src/extract.ts`: added `stripLinks()`, `stripMedia()`, `applyOffset()` helpers (shared by fetch and crawl).

### Changed
- Bumped version to 2.3.1 (`package.json` + `server.ts` MCP version + `docs/architecture.md` + `docs/data_model.md`).
- `docs/data_model.md`: extended fetch_web input table with 6 new rows (deadline_ms, tier, links, media, since_last, offset) and output descriptions (deadline.hit, tier modes, links/media stripping, since_last banner, offset).
- `DESIGN.md`: updated token-economy principle (links/media), output rules (links/media/since_last/offset), error codes (fetch deadline.hit), naming (tier enum), golden path (links/since_last example).
- `README.md`: Tool API fetch_web row now lists 16 params (up to offset).

### Fixed
- `src/tools/crawlWeb.ts`: hardened crawler SSRF guard — every dequeued `item.url` is now validated via `assertSafeUrl` before `fetchDom`; on failure records `skipped: {url, reason: "ssrf: ..."}` and `continue`. Frontier expansion also validates each `abs` via `assertSafeUrl` before `pushQueue`, silently skipping private/loopback targets.
- `src/tools/fetchWeb.ts`: fixed `since_last` & `offset` cache pipeline — removed `o.offset` from `settleKey()` (no `off:N` bifurcation), ensured `pageCache.set(key, rawRendered)` saves clean rendered content BEFORE `applyOffset`/`handleSinceLast`/link/media stripping; those transforms now happen strictly on the read path after cache retrieval (both hits and fresh renders). Prevents duplicate `> [changed …]` banners and enables `offset` reuse on hits.
- `tests/qa-boundary-tests.ts`: expanded to V3 suites — `V3a` verifies `applyOffset` on cache hits without key bifurcation (`settleKey` no `off:`), `V3b` verifies `since_last` repeated fetch returns stable one-liner without duplicate banners (and changed banner on actual change), `V3c` verifies `crawlWeb` SSRF private IP rejection via `isPrivateAddress` (127.0.0.1, 10/8, 192.168/16, 172.16/12, 169.254/16).

### Notes
- Remaining DonSeTch gaps deferred: `budget_tokens`, `image_text` (OCR), `actions`/`shot` (browser control), reference handles (L/S) — require Ghost browser / OCR runtime not present in blowsh image. Documented in `tasks/qa/06-` and `docs/architecture.md` roadmap.

## [2.3.0] - 2026-09-01

### Added
- `fetch_web`: **focus** (BM25-lite relevance filter — keeps only blocks scoring against query, header `> Focus filter ...`, falls back with `[focus: no blocks matched ...]`; 50-80% token reduction) — DonSeTch parity.
- `fetch_web`: **toc** (heading outline only, `extractToc()`) and **section** (single section by heading substring, `extractSectionHtml()`) — two cheap calls replace one expensive full-page fetch.
- `fetch_web`: **must_contain** probe mode (MATCH/NO-MATCH + ≤3 excerpts, `probeMustContain()`; substring or `/regex/` case-insensitive, ~60 tokens vs 4k) — verification without context bloat.
- `fetch_web`: **archive** resurrection (`archive="auto"` on hard failure serves Wayback `archive.org/wayback/available` snapshot labeled `> [archive snapshot from YYYY-MM-DD ...]`; `archive="only"` goes straight to Wayback; `archive.stale` error when none).
- `fetch_web`: **stitch** (`stitch=true` follows `rel=next` up to 6 parts / 48k chars, `findNextUrl()` + `fetchStitchedMarkdown()`, same-host only, `*(part N)*` markers).
- `search_web`: **query_variants** (max 2 alternate formulations, searched in parallel via `searchSingleQuery()` per variant, merged with dedup).
- `search_web`: **intent** (`auto|web|code|paper|news|entity`, `detectIntent()` — code→GitHub, paper→arXiv, news→HN Algolia, entity→Wikipedia opensearch, fetched via direct axios verticals).
- `search_web`: **deadline_ms** (hard budget 500-600000ms, races whole search → `FetchError: deadline.hit: search timed out ...` with stable code).
- `search_web`: expanded to **4 rendered engines** (DDG + Bing + Brave + Mojeek) fused by **consensus** (`mergeResults()` — cross-engine agreement sorting, not winner-takes-all) plus query cache (`queryCache`, intent-aware TTL 300s-1800s).
- **New tool `crawl_web`**: sitemap-aware crawl (`discoverSitemaps()` + `parseSitemapXml()`), frontier best-first (`scoreCandidate()` BM25-lite), Governor pacing (dwell variance + crawl-delay + exponential backoff on 429), globs (`scopeAllowed`/`effectiveExcludes`), `robots.txt` (`fetchRobots`/`isAllowed`), budgets (`max_pages`/`max_total_chars`/`deadline_s`/`max_depth`), disk-backed **resume tokens** (`blowsh-crawl-resumes.json`, 30 min TTL, atomic rename) and **since_last** delta (`blowsh-crawl-fingerprints.json`, <24h), `qualityScore`/`contentKind`, stop reasons (`FrontierEmpty|MaxPages|CharBudget|DepthLimit|Deadline|ThrottledOut`), `crawl_delay` surfacing.
- `src/extract.ts`: added helpers `focusFilter`, `extractToc`, `extractSectionHtml`, `probeMustContain`, `findNextUrl` (shared by fetch and crawl).

### Changed
- Bumped version to 2.3.0 (`package.json` + `server.ts` MCP version).
- `docs/data_model.md`: full input/output specs for fetch_web new params and crawl_web (5 tools total).
- `docs/architecture.md`: project structure + system diagram + component sections updated for 5 tools, new helpers, and crawl persistence files.
- `DESIGN.md`: token-economy principle extended (focus/toc/must_contain), output rules (focus/archive/stitch/probe/toc shapes), error codes (archive.stale, deadline.hit, Section not found, resume expired), naming (crawl_web), golden paths.
- `README.md`: Key Features, How it Works, Example Usage (focus/probe/crawl), Project Structure, Tool API (fetch_web/search_web/crawl_web), AI-Guided Selection updated for v2.3.0.

### Gap vs DonSeTch (remaining, deferred to v2.4)
- Reference handles (L/S), progressToken streaming, full page-memory diff, domain adapters (Reddit/npm/PyPI/crates), browser actions (click/type/press), temporal stealth/TLS — documented in `docs/architecture.md` roadmap and task backlog.

## [2.2.1] - 2026-08-23

### Fixed
- `search_web`: Bing search results now return real destination URLs instead of Bing redirect wrappers (`bing.com/ck/a?...`). Unified redirect decoding across DuckDuckGo (`uddg` param), Bing (`u` base64 param with 2-byte version prefix stripping), and Google (`/url?q=` param) into a single `decodeRedirect()` function.
- `fetch_web`: Added pre-fetch Content-Type sniff (5s timeout HEAD/GET probe) before invoking Browsh. Non-HTML endpoints (JSON APIs, plain text, SSL errors) now return immediately instead of wasting 30s on a Browsh timeout. Non-2xx statuses propagate with HTTP status code in the error message. Fixed GET fallback that used `maxContentLength: 0` (rejected every response body).
- `fetch_web` non-HTML fast path: Added 10 MB `maxContentLength` safety cap and `truncate()` to prevent OOM on oversized JSON/text responses. Exceeding the cap throws a descriptive `FetchError`.
- `fetch_web` plain text: Rewrote `cleanPlainText()` to detect and strip the minimum consistent leading indentation across all content lines, removing Browsh terminal padding while preserving relative indentation (e.g. code blocks, indented paragraphs).
- `extract_links`: Replaced simple semantic element stripping with scoring-based link ranking. Links are scored via URL depth, text descriptiveness, and DOM position heuristics. Noise links (login, settings, terms, status pages) are filtered out. Content links now consistently appear first.

### Changed
- Bumped version to 2.2.1.

## [2.2.0] - 2026-08-17

### Added
- Prebuilt container image published to GitHub Container Registry: `ghcr.io/mokhtarabadi/blowsh-mcp:latest`. New Docker users can pull and run the server directly without building locally.
- CI/CD: GitHub Actions workflow `.github/workflows/docker-publish.yml` builds and pushes the image on `main` pushes and `v*` tags (tag set: `latest`, branch, semver, `sha-<sha>`), with a container smoke test (MCP initialize → tools/list) that fails the run if the tool surface is broken.
- OCI provenance labels on the Docker image (`org.opencontainers.image.*`).

### Changed
- Bumped version to 2.2.0 (`package.json` + server-reported MCP version).
- README documents the prebuilt image (Quick Start) and opencode config examples now use `ghcr.io/mokhtarabadi/blowsh-mcp:latest` with a 120 s timeout.
- `docs/architecture.md` deployment section updated with registry + CI/CD distribution path.

## [2.1.1] - 2026-08-03

### Fixed
- `search_web` latency: DuckDuckGo and Bing are now rendered concurrently; the first engine to return results aborts the other (worst case bounded by the slowest single engine instead of the sum). The DDG Instant Answer probe runs in parallel too.
- `search_web` timeouts (`-32001`): enrichment is now sequential with a 45 s wall-clock budget, and searches can no longer exceed the engines' combined render time — total worst case ~50 s, safely inside the recommended 120 s client timeout.
- `browshManager` `ECONNREFUSED 127.0.0.1:4333`: one-shot respawn-and-retry now also engages when the renderer port is gone (browser crashed externally, not just after a recycle), via `ECONNREFUSED`/`ECONNRESET`/`EHOSTUNREACH`/`ENETUNREACH` detection; cancellation (engine race abort) passes through untouched.
- `search_web` results now carry `fetched_at` (UTC epoch ms) so stale search results are detectable by consumers.

### Changed
- Bumped version to 2.1.1.
- opencode MCP client config: blowsh server timeout and `experimental.mcp_timeout` raised from 30 s to 120 s (global + project configs).

## [2.1.0] - 2026-08-03

### Added
- `search_web`: `page` parameter for paginated search results (1–10, DuckDuckGo & Bing offset synthesis).
- `search_web`: DuckDuckGo Instant Answer fast path — zero-click abstracts surfaced as a synthetic result when available.
- `search_web`: `enrich` opt-in flag — top-3 result snippets replaced with fetched markdown content (≤1500 chars).
- `fetch_web`: `type: "pdf"` — SSRF-guarded direct PDF download with pdftotext extraction (configurable size cap `PDF_MAX_BYTES`, default 20 MB).
- `browshManager`: request-count-based process recycling (`BROWSH_RECYCLE_REQUESTS`, default 100).
- `browshManager`: idle timeout with automatic kill + cache mop (`BROWSH_IDLE_TIMEOUT_MS`, default 10 min).

### Changed
- Bumped version to 2.1.0.
- Dockerfile: added `poppler-utils` for PDF text extraction.

## [2.0.0] - 2026-08-02

### Added
- `search_web` tool: search the web (DuckDuckGo HTML with Bing fallback) and return ranked results with snippets.
- `extract_links` tool: list hyperlinks (text + absolute URL) from a JS-rendered page.
- `fetch_web_batch` tool: fetch up to 10 URLs per call with per-URL error isolation.
- `fetch_web` options: CSS `selector` extraction, `max_chars` output cap, and `wait_ms` JS-settle polling.
- Readability-style main-content extraction for Markdown output (boilerplate stripping).
- In-memory TTL render cache (default 5 min, `CACHE_TTL_MS`).
- SSRF guard: blocks loopback, private, link-local, reserved, and IPv4-mapped-IPv6 addresses (DNS-resolved); disable with `ALLOW_PRIVATE_URLS=true`.
- Structured error signaling: tools throw `FetchError` (with HTTP status when available); MCP responses set `isError` instead of returning error strings.
- Configurable per-request timeout (`BROWSH_REQUEST_TIMEOUT_MS`, default 30 s).

### Changed
- Upgraded all dependencies to latest: `@modelcontextprotocol/sdk` 1.30.0, `axios` 1.19.0, `cheerio` 1.2.0, `dotenv` 17.4.2, `zod` 4.4.3, TypeScript 7.0.2.
- Replaced `ts-node` with `tsx` for `npm run dev`; `tsconfig` moved to `moduleResolution: NodeNext` (TS 7 requirement).
- Node engine requirement raised to `>=20.18.1` (zod 4).
- Dockerfile: multi-stage build, html2markdown bumped to v2.5.2, `BROWSH_FIREFOX_PATH` set to `/usr/bin/firefox-esr`.
- MCP server version reported as 2.0.0.
