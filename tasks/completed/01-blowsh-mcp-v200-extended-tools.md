# Task 01: Blowsh-MCP v2.0 — Extended Search & Structured Extraction Toolset

**File:** `tasks/completed/01-blowsh-mcp-v200-extended-tools.md`
**Source:** manager
**Type:** feature
**Status:** closed

## Goal

Upgrade blowsh-mcp from a single `fetch_web` fetcher into a deep-research toolset: add web search, link extraction, and multi-URL batch fetching; extend `fetch_web` with CSS-selector extraction, output capping, and JS-settle polling; harden the server with an SSRF guard, TTL render cache, and structured error signaling.

## Manager's Notes

- The manager authorized full execution of the improvement set previously handed over (search, extraction, caching, SSRF, real errors, docs).
- Requirement: forward-reporting of results via the MCP stdio transport; no ports exposed.
- All feature verification must run through Docker (`docker run --rm -i`); Firefox/Browsh/html2markdown are not installed on the host.
- README, CHANGELOG, `.env.example`, and docs must be kept in sync.

## Phase 1: Tooling

### Local TODOs

- [x] Implement SSRF guard module `src/ssrf.ts` + `FetchError` in `src/errors.ts` (HTTP-status-carrying).
- [x] Implement TTL render cache `src/cache.ts` and extraction utilities `src/extract.ts` (main-content, selectors, truncation).
- [x] `fetch_web` gains `selector`, `max_chars`, `wait_ms` (JS-settle polling); errors now thrown, not string-gagged.
- [x] New tools: `search_web` (DuckDuckGo HTML + Bing fallback), `extract_links`, `fetch_web_batch`.
- [x] `src/server.ts`: 4 tools registered, zod v4 validation, `isError: true` responses; version 2.0.0.
- [x] `browshManager` reports HTTP status on failures; configurable request timeout.

## Phase 2: Containerization & Testing

### Local TODOs

- [x] Fat multi-stage Dockerfile (Firefox + Browsh v1.8.0 + html2markdown v2.5.2); `BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr`.
- [x] MCP JSON-RPC smoke test over docker stdio: initialize → tools/list → tools/call (plain/html/markdown, cache hit, selectors, cap, wait, search, links, batch, SSRF block, bad protocol).
- [x] Peak RAM measurement of the container (~583 MiB) for capacity planning.

## Phase 3: Docs & Dependency Audit

### Local TODOs

- [ ] Bump deps to latest (SDK 1.30, zod 4, TS 7, tsx); fix tsconfig `NodeNext`.
- [ ] Update README (Tool API, env table, security), CHANGELOG v2.0.0, `.env.example`.
- [x] Create AGENTS.md, DESIGN.md, docs/conventions.md, docs/architecture.md, docs/data_model.md, tasks/ Kanban scaffold.
- [x] Audit against the `audit-agents` criteria (PASS).

---

## OpenCode Execution Log & Reasoning

_Stage: Phase 0 generation (2026-08-02). Files: AGENTS.md, DESIGN.md, docs/*, tasks/*_

### Architecture reasoning

Chosen a modular layout mirroring the tool surface: `tools/*` are thin orchestrators over `browshManager` + `html2markdownManager`; shared cross-cutting concerns (SSRF, cache, extraction, errors) live in dedicated single-purpose modules to respect SRP and keep `server.ts` a pure router.

Key design principles:

1. **Errors are first-class.** `fetchWeb` previously returned `"Fetch failed: …"` strings as success payloads. Now every tool throws `FetchError`; `server.ts` renders `isError: true` with a prefixed message (`FetchError: … [http <status>]`). Verified in the container: SSRF blocks, bad protocols, and unmatched selectors all surface as `isError: true`.
2. **SSRF first.** `assertSafeUrl()` (DNS-resolved private/IP-blocklist ranges, local), runs BEFORE any URL reaches browsh in all four tools, including the batch path and the search engines. Loopback fetches of the Browsh service are refused differently.
3. **Cache at the right boundary.** The TTL `pageCache` stores POST-JS renders keyed by `(url, settle-mode, type, selector)` and is truncated only at read time — `max_chars` never duplicates cached copies. Verified: second `fetch_web` returned in 12ms vs 6.6s cold.
4. **JS-settle polling** is a pragmatic approximation of `wait_ms`: successive independent renders of the same URL, compared for byte-identity. Browsh's server model (one tab per request) makes classic in-page waits impossible; polling is safe and observable, and SRP-pointed in `render()`.
5. **Readability-ish main-content extraction** (prefer `main`/`article`/content id/class → largest text-density block; strip nav/footer/aside/script/form) keeps Markdown LLM-friendly without a full DOM dump.

Verfied via docker smoke test (14/14 green): initialize → tools/list → tools called for all four tools + error paths + caching + SSRF. Peak RSS ~583 MiB.

Reasoning for the memo document: the DateTime standard in `docs/conventions.md` governs env/API boundaries (epoch-ms + `TZ=UTC`); this server has no persistent datastore (only the in-memory TTL cache), so the "UTC at rest" clause is largely N/A but codified for consistency in the ecosystem.

**Post-execution note:** the task file is created per the task-generator template with `BEGIN/END_GIT_DIFF` markers; the factual diff is injected via `custom_context_stage_and_inject_diff` once the Orchestrator picks the task up.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `f7a1feee09aecf7e42e7987186f517f1cbb3f208`
<!-- END_GIT_DIFF -->