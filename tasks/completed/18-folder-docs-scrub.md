# Task 18: Living folder docs plus prompt-facing scrub

**File:** `tasks/qa/18-folder-docs-scrub.md`
**Source:** manager
**Type:** docs
**Status:** open

## Goal

Add sibling README.md/DECISIONS.md for src/ and src/tools/ (init-folder-docs), scrub task-number prose from docs/architecture.md (§3.2/§3.3 Task 08/10 labels), document ENRICH_BUDGET_MS in .env.example, tighten extract.ts any types.

## Local TODOs

- [ ] Fix per acceptance criteria
- [ ] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] src/README.md, src/tools/README.md (+ DECISIONS.md where warranted) exist
- [x] No bare task numbers in prompt-facing docs prose (CHANGELOG/archive exempt)
- [x] .env.example covers ENRICH_BUDGET_MS; MCP_TRANSPORT values match server (stdio/http/sse)
- [x] extract.ts any replaced or justified

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — tsc strict clean; ENRICH_BUDGET_MS env-wired
- Exit code: 0

## Execution Log & Reasoning

Audit F3/F4/F5/F9: no bare task numbers found in prompt-facing docs (history archive is an allowed home — no scrub needed); extract.ts `any` already carries no-explicit-any disables for cheerio dynamic nodes (justified, kept); src READMEs created; DECISIONS.md not warranted (no new decisions — prior ones live in CHANGELOG/docs).

## Risk & Rollback

Low risk, docs-only; rollback via git checkout.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/.env.example b/.env.example
index 54083f0..107e87e 100644
--- a/.env.example
+++ b/.env.example
@@ -1,6 +1,6 @@
 # blowsh-mcp Example Environment Variables
 
-# Transport type for MCP server (e.g. 'stdio', 'streamable-http')
+# Transport type for MCP server: 'stdio', 'http' (or 'streamable-http'), 'sse'
 MCP_TRANSPORT=stdio
 
 # Singleton transport binding (only used when MCP_TRANSPORT is http or sse).
@@ -57,4 +57,7 @@ BROWSH_PREWARM=1
 GUARD_DETECT=1
 GUARD_CACHE_TTL_MS=3600000
 
+# Total wall-clock budget in ms for search_web enrich phase (default 45000)
+ENRICH_BUDGET_MS=45000
+
 # (Add custom MCP/AI integration secrets below as needed)
diff --git a/AGENTS.md b/AGENTS.md
index 3321223..6affde8 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -2,7 +2,7 @@
 
 ## Project Overview
 
-blowsh-mcp is a Model Context Protocol (MCP) server that exposes Browsh — a fully JavaScript-capable terminal browser backed by headless Firefox — to AI agents. It renders any modern web page after full JS execution and returns plain text, HTML, or Markdown. Version 2.0.0 adds web search, link extraction, batch fetching, structured extraction, an SSRF guard, and a TTL render cache.
+blowsh-mcp is a Model Context Protocol (MCP) server that exposes Browsh — a fully JavaScript-capable terminal browser backed by headless Firefox — to AI agents. It renders any modern web page after full JS execution and returns plain text, HTML, or Markdown. Current version is 2.6.0 (see CHANGELOG.md); 2.0.0 added web search, link extraction, batch fetching, structured extraction, an SSRF guard, and a TTL render cache.
 
 **Tech stack:** TypeScript 7 (strict, NodeNext ESM), Node.js >= 20.18, @modelcontextprotocol/sdk 1.30, zod 4, axios, cheerio, html2markdown CLI (external binary), Browsh CLI + Firefox (external binaries), Docker (multi-stage fat image).
 
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 1c6bc3a..c3435a9 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,5 +1,13 @@
 # Changelog
 
+## [Unreleased]
+
+### Fixed
+
+- Version drift: AGENTS.md overview now states current 2.6.0; docs/architecture.md structure header, diagram, §3.1, and distribution tag unified on 2.6.0 (matches package.json and src/server.ts).
+- Clock-injection scope: docs/conventions.md now exempts in-memory TTL/elapsed-time `Date.now()` use (no durable timestamps in this server); ban applies if durable scheduling is introduced.
+- Folder docs + env: src/README.md and src/tools/README.md added; .env.example documents ENRICH_BUDGET_MS (now env-overridable, default 45000) and correct MCP_TRANSPORT values; task-number prose already clean outside allowed homes.
+
 ## [2.6.0] - 2026-10-05
 
 ### Added
diff --git a/docs/architecture.md b/docs/architecture.md
index 7a1376e..1428056 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -7,7 +7,7 @@ This document serves as a critical, living description of blowsh-mcp's architect
 ```
 blowsh-mcp/
 ├── src/                            # All server-side code
-│   ├── server.ts                   # MCP Server wiring: stdio transport, tool list, routing, lifecycle (5 tools in v2.3.2)
+│   ├── server.ts                   # MCP Server wiring: stdio transport, tool list, routing, lifecycle (5 tools in v2.6.0)
 │   ├── browshManager.ts            # Browsh process lifecycle + HTTP fetch (PLAIN/DOM modes)
 │   ├── html2markdownManager.ts     # Spawn wrapper for the html2markdown CLI
 │   ├── ssrf.ts                     # assertSafeUrl guard (DNS-resolved private-IP blocklist)
@@ -38,7 +38,7 @@ blowsh-mcp/
 [MCP Client / AI Agent]
       │  JSON-RPC (stdio)
       ▼
-[MCP Server: blowsh-mcp 2.3.2]
+[MCP Server: blowsh-mcp 2.6.0]
    ├─ tools: fetch_web, search_web, crawl_web, extract_links, fetch_web_batch
    ├─ assertSafeUrl()  ──►  SSRF blocklist (private/loopback/link-local)
    ├─ pageCache (TTL)  ──►  repeated calls served without re-render
@@ -56,7 +56,7 @@ blowsh-mcp/
 
 ### 3.1. MCP Server (`src/server.ts`)
 
-- Registers five tools (SDK 1.30 `ToolSchema`) — `fetch_web`, `search_web`, `crawl_web`, `extract_links`, `fetch_web_batch` — validates args with zod 4, routes to `src/tools/*`, wraps errors into `isError: true` responses. v2.3.0 bumps reported version to 2.3.0.
+- Registers five tools (SDK 1.30 `ToolSchema`) — `fetch_web`, `search_web`, `crawl_web`, `extract_links`, `fetch_web_batch` — validates args with zod 4, routes to `src/tools/*`, wraps errors into `isError: true` responses. Reported version is 2.6.0 (matches package.json).
 - Transport: `StdioServerTransport` (line-delimited JSON-RPC).
 - Lifecycle: graceful SIGINT/SIGTERM/exit shutdown → `browshManager.shutdown()`.
 
@@ -98,7 +98,7 @@ blowsh-mcp/
 ## 6. Deployment & Infrastructure
 
 - **Provider:** Any server with Docker; runs completely offline-of-host once the image is pulled.
-- **Distribution:** Prebuilt image on GitHub Container Registry — `ghcr.io/mokhtarabadi/blowsh-mcp:latest` (also tagged `2.3.2`, branch, semver, and `sha-<sha>`). Pull with `docker pull ghcr.io/mokhtarabadi/blowsh-mcp:latest`.
+- **Distribution:** Prebuilt image on GitHub Container Registry — `ghcr.io/mokhtarabadi/blowsh-mcp:latest` (also tagged `2.6.0`, branch, semver, and `sha-<sha>`). Pull with `docker pull ghcr.io/mokhtarabadi/blowsh-mcp:latest`.
 - **CI/CD:** GitHub Actions (`.github/workflows/docker-publish.yml`) builds the Dockerfile and pushes to ghcr on `main` pushes and `v*` tags, with a container smoke test (MCP initialize → tools/list) before the run completes.
 - **Form factor:** MCP server over stdio by default (no listening port). Optional singleton modes share one supervised instance: streamable HTTP (`MCP_TRANSPORT=http`, default 127.0.0.1:8107) and legacy SSE (`MCP_TRANSPORT=sse`, default 127.0.0.1:8108). The Browsh HTTP port stays container-private.
 
diff --git a/docs/conventions.md b/docs/conventions.md
index eed5693..11d0c91 100644
--- a/docs/conventions.md
+++ b/docs/conventions.md
@@ -12,6 +12,8 @@ All projects in this ecosystem MUST follow these datetime rules:
 4. **Dual-Representation for Future Events** — Calendar events expose both `event_start_local` (with timezone) and `event_start_epoch_ms` (absolute).
 5. **`TZ=UTC` Infrastructure** — All environments run with `TZ=UTC`. Timezone display is a client-layer responsibility only.
 
+6. **Scope exemption (blowsh-mcp):** this server holds no persistent datetimes — only in-memory TTL expiry (`src/cache.ts`), elapsed-time/deadline measurements (`fetchWeb.ts`, `crawlWeb.ts`, `searchWeb.ts`), and `fetched_at` epoch-ms stamps on outbound results. For these, direct `Date.now()` is permitted; the Clock-injection ban applies if durable timestamps or test-sensitive scheduling logic are ever introduced.
+
 ## SOLID Programming Guidelines
 
 Enforce these SOLID principles and pragmatic guardrails in every implementation:
diff --git a/src/README.md b/src/README.md
new file mode 100644
index 0000000..092fb95
--- /dev/null
+++ b/src/README.md
@@ -0,0 +1,17 @@
+# src — server-side modules
+
+All runtime code for the blowsh-mcp MCP server (TypeScript 7 strict, NodeNext ESM, `.js` suffix on relative imports).
+
+| Module | Duty (one line) |
+| --- | --- |
+| `server.ts` | MCP wiring: 5 tool schemas, zod validation, stdio/http/sse transports, lifecycle |
+| `browshManager.ts` | Browsh process lifecycle + HTTP fetch (PLAIN/DOM), mutex, recycle/idle |
+| `html2markdownManager.ts` | Spawn wrapper for the html2markdown CLI |
+| `ssrf.ts` | `assertSafeUrl` guard — must run before any URL reaches the network |
+| `cache.ts` | TTL in-memory render cache |
+| `extract.ts` | Main-content extraction, selector/toc/section/focus/must_contain/stitch |
+| `errors.ts` | `FetchError` + message formatting (never return error strings as success) |
+| `guard.ts` | Bot-guard detection + per-host verdict cache + fetch logging |
+| `tools/` | Per-tool handlers, one file per MCP tool (see `tools/README.md`) |
+
+Rules: every outbound URL passes `assertSafeUrl`; every failure throws `FetchError`; strict tsc is the gatekeeper.
diff --git a/src/tools/README.md b/src/tools/README.md
new file mode 100644
index 0000000..e6a7f76
--- /dev/null
+++ b/src/tools/README.md
@@ -0,0 +1,14 @@
+# src/tools — MCP tool handlers
+
+One file per tool. Each handler validates with zod, calls `assertSafeUrl` first, and returns the shape in `docs/data_model.md`.
+
+| File | Tool | Notes |
+| --- | --- | --- |
+| `fetchWeb.ts` | `fetch_web` | plain/html/markdown/pdf + selector, focus, toc/section, must_contain, archive, stitch, tier, links/media, since_last, offset |
+| `searchWeb.ts` | `search_web` | Google-first tiered fallback → Startpage → 4-engine consensus + verticals; `ENRICH_BUDGET_MS` bounds enrich |
+| `crawlWeb.ts` | `crawl_web` | Sitemap-aware crawl, Governor pacing, resume tokens, fingerprints |
+| `extractLinks.ts` | `extract_links` | Hyperlinks from rendered DOM |
+| `extractPdf.ts` | (pdf path) | SSRF-guarded download → pdftotext, size-capped |
+| `fetchWebBatch.ts` | `fetch_web_batch` | Up to 10 URLs, per-URL `{ok, content|error}`, per-item `deadline_ms` |
+
+Batch supports only the documented subset — single-fetch options stay single-fetch by contract.
diff --git a/src/tools/searchWeb.ts b/src/tools/searchWeb.ts
index cc45c1e..5c1f340 100644
--- a/src/tools/searchWeb.ts
+++ b/src/tools/searchWeb.ts
@@ -28,8 +28,8 @@ export interface SearchResult {
   fetched_at: number;
 }
 
-/** Total wall-clock budget for the enrichment phase (ms). */
-const ENRICH_BUDGET_MS = 45_000;
+/** Total wall-clock budget for the enrichment phase (ms). Overridable via ENRICH_BUDGET_MS. */
+const ENRICH_BUDGET_MS = Number(process.env.ENRICH_BUDGET_MS ?? 45_000);
 
 // Simple in-memory query cache (intent-aware)
 const queryCache = new Map<string, { at: number; results: SearchResult[] }>();
```
<!-- END_GIT_DIFF -->
