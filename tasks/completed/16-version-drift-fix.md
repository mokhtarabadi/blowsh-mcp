# Task 16: Fix version drift across AGENTS, architecture, and package

**File:** `tasks/qa/16-version-drift-fix.md`
**Source:** manager
**Type:** docs
**Status:** open

## Goal

Single source of truth for version: package.json (2.6.0) wins; AGENTS.md overview still says 2.0.0 and docs/architecture.md mixes 2.3.2/2.3.0.

## Local TODOs

- [ ] Fix per acceptance criteria
- [ ] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] AGENTS.md overview version matches package.json
- [x] docs/architecture.md §3.1, diagram, and structure header agree on one version
- [x] src/server.ts reported version matches package.json

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — tsc strict clean at version 2.6.0
- Exit code: 0

## Execution Log & Reasoning

Audit F1: version drift (AGENTS 2.0.0 vs arch 2.3.x vs package 2.6.0).

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
index 1c6bc3a..0f505cf 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,5 +1,11 @@
 # Changelog
 
+## [Unreleased]
+
+### Fixed
+
+- Version drift: AGENTS.md overview now states current 2.6.0; docs/architecture.md structure header, diagram, §3.1, and distribution tag unified on 2.6.0 (matches package.json and src/server.ts).
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
```
<!-- END_GIT_DIFF -->
