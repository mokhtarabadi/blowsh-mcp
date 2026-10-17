# Task 17: Resolve Clock-injection vs Date.now convention gap

**File:** `tasks/qa/17-clock-convention-gap.md`
**Source:** manager
**Type:** docs
**Status:** open

## Goal

docs/conventions.md mandates injectable Clock and bans direct Date.now/new Date, but src/cache.ts, src/tools/crawlWeb.ts, fetchWeb.ts, searchWeb.ts use Date.now() throughout with no Clock abstraction.

## Local TODOs

- [ ] Fix per acceptance criteria
- [ ] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] Either introduce a Clock abstraction and migrate business logic, or scope the convention (infra/ephemeral TTL cache exempt) with AGENTS.md + conventions.md updated
- [x] grep for direct time access reviewed and recorded

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — docs-only change; tsc strict clean
- Exit code: 0

## Execution Log & Reasoning

Audit F2 resolved by scoping (option 2): no durable timestamps exist in this server, so Clock abstraction would add indirection with no testability gain. Exemption recorded in docs/conventions.md §6.

## Risk & Rollback

Low risk, docs-only; rollback via git checkout.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
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
index 1c6bc3a..0afde08 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,5 +1,12 @@
 # Changelog
 
+## [Unreleased]
+
+### Fixed
+
+- Version drift: AGENTS.md overview now states current 2.6.0; docs/architecture.md structure header, diagram, §3.1, and distribution tag unified on 2.6.0 (matches package.json and src/server.ts).
+- Clock-injection scope: docs/conventions.md now exempts in-memory TTL/elapsed-time `Date.now()` use (no durable timestamps in this server); ban applies if durable scheduling is introduced.
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
```
<!-- END_GIT_DIFF -->
