# Changelog

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

## [Unreleased]
- Markdown conversion now uses the [html2markdown CLI](https://github.com/JohannesKaufmann/html-to-markdown) for higher fidelity and plugin support.
- Added `src/tools/html2markdownManager.ts` as a wrapper for the CLI.
- Updated Dockerfile to install html2markdown CLI.
- Updated `.env` and `.env.example` to support `HTML2MARKDOWN_PATH`.
- Updated README with new requirements and configuration options.
- Unified all fetch tools into `fetch_web` with a `type` parameter.
- Cleaned up project by removing legacy fetch tools.
