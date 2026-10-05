# Task 15: Release v2.6.0

**File:** `tasks/qa/15-release-v260.md`
**Source:** manager
**Type:** feature
**Status:** in-progress

## Goal

Cut release v2.6.0 (minor: Google-first keyless search with tiered fallback chain from Task 14): archive completed tasks, bump version, stamp CHANGELOG, build, close, hand push/tag commands to Manager for CI/CD.

## Manager's Notes

- Manager ordered on 2026-10-05: read memory first, make a release, archive tasks, create a task and auto-close it, hand CI/CD trigger commands to Manager.
- Memory rulings applied: archive `tasks/completed/` on every release; publishing stays Manager-owned; bundled close-plus-release authorization is valid.
- Version decision: 2.6.0 minor (new backward-compatible `search_web` capability, no breaking changes).

## Local TODOs

- [x] Archive completed tasks 13 and 14 to `tasks/archive/`
- [x] Bump `package.json` + `src/server.ts` version to 2.6.0
- [x] Stamp CHANGELOG `[Unreleased]` → `[2.6.0] - 2026-10-05`
- [x] Build (`npm run build`) exit 0
- [ ] Auto-close via QA transition + atomic commit; hand push/tag commands to Manager

## Acceptance Criteria

- [x] `package.json` and server-reported version are 2.6.0
- [x] CHANGELOG has a dated `[2.6.0]` section, no `[Unreleased]` leftovers for shipped items
- [x] `npm run build` exits 0
- [x] Tasks 13 and 14 archived; `tasks/completed/` empty
- [ ] Tag `v2.6.0` push commands handed to Manager (Manager pushes)

## Verification Evidence

- **Test command:** rtk test npm run build
- **Expected result:** tsc strict passes, exit 0
- **Actual result:** PASS — `rtk test npm run build` exit 0, strict tsc clean at version 2.6.0
- **Exit code:** 0

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task.

## Manager Decisions

**[2026-10-05] [D1] [EXECUTOR-DETECTED]:** Release v2.6.0 minor with auto-close
- **Rationale:** Manager ordered release plus archive plus auto-close in one message after memory-first review.
- **Alternatives considered:** Patch bump (rejected: new feature, not a fix).
- **Impact:** Version files plus CHANGELOG change only. Push and tag stay Manager-owned.

## Risk & Rollback

- **Risk:** CI publish needs `packages: write` (fine via GITHUB_TOKEN).
- **Rollback plan:** delete tag `v2.6.0` locally + remote, revert version commits, keep image at previous tag.

---

## Execution Log & Reasoning

**[2026-10-05] [EXECUTION-DETECTED]:** Memory-first release per Manager order. Searched memory (no local hits for release/archive; standing rulings found via manager decisions), loaded task-generator, archive-tasks, versioning-and-release, github skills. Release plan v2.6.0 approved by Manager. Archived tasks 13 and 14.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index f716f58..1c6bc3a 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,6 +1,6 @@
 # Changelog
 
-## [Unreleased]
+## [2.6.0] - 2026-10-05
 
 ### Added
 - `search_web` tiered keyless fallback chain: Google attempted first with robot-block detection and short-circuits on clean results (~6x speedup); Startpage proxy second; 4-engine consensus pool (Brave, Mojeek, Bing, DDG) third. Relative `/url?q=` Google redirects decoded. `isBlockedPage` hardened against snippet-text false positives. No new env keys.
diff --git a/package.json b/package.json
index 1ddb4cc..f199c3a 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "blowsh-mcp",
-  "version": "2.5.0",
+  "version": "2.6.0",
   "description": "An MCP server exposing Browsh (the JavaScript-capable terminal browser) to AIs and agents over the Model Context Protocol.",
   "author": "Mohammad Reza Mokhtarabadi <mmokhtarabadi@gmail.com>",
   "license": "MIT",
diff --git a/src/server.ts b/src/server.ts
index 688362e..3d5af80 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -253,7 +253,7 @@ async function createServer() {
   const server = new Server(
     {
       name: "blowsh-mcp",
-      version: "2.5.0",
+      version: "2.6.0",
     },
     {
       capabilities: { tools: {} },
```
<!-- END_GIT_DIFF -->
