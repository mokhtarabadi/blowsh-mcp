# Task 271: Release v2.9.1

**File:** `tasks/completed/271-release-v291.md`
**Source:** manager
**Type:** feature
**Status:** closed
**Finished:** 2026-11-25T21:39:23Z
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
- [x] Stage via MCP and move to `tasks/qa/`
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
- Code Reviewer final verdict: PO_REVIEW_PENDING (technical approval). Manager approved closure.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `ea1ccf92d71740a061ee582e15e2059cde1c2764`
<!-- END_GIT_DIFF -->
