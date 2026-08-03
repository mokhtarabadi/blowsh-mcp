# Changelog

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
