# Task 271: Release v2.9.1

**File:** `tasks/qa/271-release-v291.md`
**Source:** manager
**Type:** feature
**Status:** in-progress
**Submitted:** 2026-11-25T21:34:17Z
**Started:** 2026-11-25T21:33:40Z

## Source Context

### Variant C: Manager (`**Source:** manager`)

## Goal

Cut patch release v2.9.1 from the unreleased Task 270 (orphan Firefox cleanup). Bump version identifiers, stamp CHANGELOG, build, close, and hand push/tag commands to the Manager.

## Manager's Notes

Patch bump (2.9.0 → 2.9.1): bug fix only (orphan Firefox profile lock sweep). No breaking changes, no new features.

## Local TODOs

- [x] Move task to `tasks/in-progress/` before editing
- [x] Bump `package.json` and `package-lock.json` version to 2.9.1
- [x] Bump `src/server.ts` version to 2.9.1
- [x] Update `AGENTS.md` current version line to 2.9.1
- [x] Update `docs/architecture.md` version references to 2.9.1
- [x] Stamp CHANGELOG `[Unreleased]` → `[2.9.1] - 2026-11-25`
- [x] Build (`npm run build`) exit 0
- [ ] Stage via MCP and move to `tasks/qa/`
- [ ] Close via commit_and_clean_task; hand push/tag commands to Manager

## Acceptance Criteria

- [x] `package.json`, `package-lock.json`, and `src/server.ts` report 2.9.1
- [x] CHANGELOG has a dated `[2.9.1]` section; `[Unreleased]` empty of shipped items
- [x] `npm run build` exits 0
- [ ] Diff staged via MCP; task moved to `tasks/qa/` then `tasks/completed/`
- [ ] Push/tag commands handed to Manager

## Verification Evidence

- **Test command:** `rtk test npm run build`
- **Expected result:** tsc strict passes, exit 0
- **Actual result:** `rtk test npm run build` exit 0, strict tsc clean at version 2.9.1. Hotfix: docs/architecture.md distribution tag updated 2.9.0→2.9.1 (no other 2.9.0 refs remain except historical tool-count annotation). Crash-circuit suite: `all 49 checks passed`, exit 0. Drift grep: only historical `v2.9.0` tool-count annotation remains.
- **Exit code:** 0 (build and tests)

## Definition of Done

- [x] Build/Test pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded
- [ ] No autonomous commit; staged via `custom_context_stage_and_inject_diff`

## Risk & Rollback

- **Risk:** Version bump in multiple files; missing one causes drift.
- **Rollback plan:** Revert version bumps and CHANGELOG stamp.

---

## Execution Log & Reasoning

- Bumped package.json, package-lock.json (2 occurrences), src/server.ts, AGENTS.md, docs/architecture.md (2 refs) to 2.9.1.
- Stamped CHANGELOG: moved Task 270 entry under [2.9.1] - 2026-11-25; [Unreleased] now empty.
- Build: `rtk test npm run build` exit 0.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/AGENTS.md b/AGENTS.md
index 6f06dd7..ba4dedf 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -2,7 +2,7 @@
 
 ## Project Overview
 
-blowsh-mcp is a Model Context Protocol (MCP) server that exposes Browsh — a fully JavaScript-capable terminal browser backed by headless Firefox — to AI agents. It renders any modern web page after full JS execution and returns plain text, HTML, or Markdown. Current version is 2.9.0 (see CHANGELOG.md); 2.0.0 added web search, link extraction, batch fetching, structured extraction, an SSRF guard, and a TTL render cache.
+blowsh-mcp is a Model Context Protocol (MCP) server that exposes Browsh — a fully JavaScript-capable terminal browser backed by headless Firefox — to AI agents. It renders any modern web page after full JS execution and returns plain text, HTML, or Markdown. Current version is 2.9.1 (see CHANGELOG.md); 2.0.0 added web search, link extraction, batch fetching, structured extraction, an SSRF guard, and a TTL render cache.
 
 **Tech stack:** TypeScript 7 (strict, NodeNext ESM), Node.js >= 20.18, @modelcontextprotocol/sdk 1.30, zod 4, axios, cheerio, html2markdown CLI (external binary), Browsh CLI + Firefox (external binaries), Docker (multi-stage fat image).
 
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 25265fa..9793b38 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -2,6 +2,8 @@
 
 ## [Unreleased]
 
+## [2.9.1] - 2026-11-25
+
 ### Fixed
 
 - Sweep orphaned Firefox for the Browsh profile on teardown, spawn, and unexpected exit; delete stale lock files only when pgrep confirms no process references the profile. Allowlisted profile paths (/data or os.tmpdir at depth 3+) and safe degrade when pkill/pgrep are missing. Regression coverage in `tests/browser-crash-circuit-tests.ts` (49 checks). See Task 270.
diff --git a/docs/architecture.md b/docs/architecture.md
index b90091f..2e3abfe 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -38,7 +38,7 @@ blowsh-mcp/
 [MCP Client / AI Agent]
       │  JSON-RPC (stdio)
       ▼
-[MCP Server: blowsh-mcp 2.9.0]
+[MCP Server: blowsh-mcp 2.9.1]
    ├─ tools: fetch_web, search_web, crawl_web, extract_links, fetch_web_batch
    ├─ assertSafeUrl()  ──►  SSRF blocklist (private/loopback/link-local)
    ├─ pageCache (TTL)  ──►  repeated calls served without re-render
@@ -56,7 +56,7 @@ blowsh-mcp/
 
 ### 3.1. MCP Server (`src/server.ts`)
 
-- Registers five tools (SDK 1.30 `ToolSchema`) — `fetch_web`, `search_web`, `crawl_web`, `extract_links`, `fetch_web_batch` — validates args with zod 4, routes to `src/tools/*`, wraps errors into `isError: true` responses. Reported version is 2.9.0 (matches package.json).
+- Registers five tools (SDK 1.30 `ToolSchema`) — `fetch_web`, `search_web`, `crawl_web`, `extract_links`, `fetch_web_batch` — validates args with zod 4, routes to `src/tools/*`, wraps errors into `isError: true` responses. Reported version is 2.9.1 (matches package.json).
 - Transport: `StdioServerTransport` (line-delimited JSON-RPC).
 - Lifecycle: graceful SIGINT/SIGTERM/exit shutdown → `browshManager.shutdown()`.
 
diff --git a/package-lock.json b/package-lock.json
index 7c9c194..c8bf50b 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,12 +1,12 @@
 {
   "name": "blowsh-mcp",
-  "version": "2.9.0",
+  "version": "2.9.1",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "blowsh-mcp",
-      "version": "2.9.0",
+      "version": "2.9.1",
       "license": "MIT",
       "dependencies": {
         "@modelcontextprotocol/sdk": "^1.30.0",
diff --git a/package.json b/package.json
index 6198f1d..cecffa7 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "blowsh-mcp",
-  "version": "2.9.0",
+  "version": "2.9.1",
   "description": "An MCP server exposing Browsh (the JavaScript-capable terminal browser) to AIs and agents over the Model Context Protocol.",
   "author": "Mohammad Reza Mokhtarabadi <mmokhtarabadi@gmail.com>",
   "license": "MIT",
diff --git a/src/server.ts b/src/server.ts
index 138a547..5263381 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -263,7 +263,7 @@ async function createServer() {
   const server = new Server(
     {
       name: "blowsh-mcp",
-      version: "2.9.0",
+      version: "2.9.1",
     },
     {
       capabilities: { tools: {} },
```
<!-- END_GIT_DIFF -->
