# Task 16: Fix version drift across AGENTS, architecture, and package

**File:** `tasks/completed/16-version-drift-fix.md`
**Source:** manager
**Type:** docs
**Status:** closed

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
**Factual Git Diff:** Stored in Commit Hash: `d82a2f88b23f8b230f1979837a2abcdfa2a35ab0`
<!-- END_GIT_DIFF -->

## Closure

Manager approval (autopilot, 2026-10-17): "auto approved for closure" + "خودکار همه رو ببند گفتم از من سوال نکن من خوابم" (close them all automatically, don't ask). Executed via commit_and_clean_task.
