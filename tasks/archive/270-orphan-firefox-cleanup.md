# Task 270: Orphan Firefox cleanup for Browsh profile locks

**File:** `tasks/completed/270-orphan-firefox-cleanup.md`
**Source:** manager
**Type:** bug
**Status:** closed
**Finished:** 2026-11-25T21:31:34Z
**Submitted:** 2026-11-25T21:21:51Z
**Started:** 2026-11-25T21:16:15Z

## Source Context

### Variant C: Manager (`**Source:** manager`)

## Goal

Prevent a stale Firefox profile lock from breaking every render after a Browsh crash/restart. When `clearProcess()` SIGTERMs the Browsh process group, Firefox can survive in its own session and keep the profile lock; the next `ensureStarted()` then fails with "A headless Firefox is already running". Sweep orphaned Firefox for the profile, gated on an allowlisted profile path and a confirmed pgrep match, and delete lock files only when no Firefox process still references the profile. The same cleanup runs on unexpected child exit and before a fresh spawn. Degrade safely when pkill/pgrep are missing.

## Manager's Notes

Working tree already contains a partial implementation in `src/browshManager.ts` (orphan cleanup helpers + call sites) and the matching ADR in `src/DECISIONS.md`. This task captures that work, adds regression coverage, syncs docs/CHANGELOG, and drives it through QA.

## Relevant Code Context

- `src/browshManager.ts:1` — imports `execFileSync` from `child_process`.
- `src/browshManager.ts:454` — `cleanupOrphanedFirefox()` before a fresh spawn in `ensureStarted`.
- `src/browshManager.ts:572` — `cleanupOrphanedFirefox()` on unexpected child exit.
- `src/browshManager.ts:797` — `cleanupOrphanedFirefox()` at end of `clearProcess()`.
- `src/browshManager.ts:801-890` — `isSafeProfilePathForKill`, `waitMsSync`, `hasMatchingProcess`, `hasPkill`, `cleanupOrphanedFirefox`.
- `src/DECISIONS.md` — two new ADRs (allowlisted/gated cleanup; tool-missing safety).
- `tests/browser-crash-circuit-tests.ts` — existing crash-circuit suite; natural home for new regression checks.

## Local TODOs

- [x] Move task to `tasks/in-progress/` before editing
- [x] Verify the partial implementation builds and existing suites pass
- [x] Add regression coverage for the orphan cleanup helpers (allowlist refusal, pkill/pgrep missing, lock deletion gated on no matching process)
- [x] Sync sibling docs (`src/README.md`), `.env.example` if needed, `CHANGELOG.md`
- [x] Run strict `tsc` build and offline suites; record evidence
- [x] Stage via MCP and move to `tasks/qa/`

## Acceptance Criteria

- [x] `clearProcess()` sweeps orphaned Firefox for the profile and removes stale lock files only when no process still references the profile.
- [x] `cleanupOrphanedFirefox()` refuses to run when `profileDir` is not under `/data` or the OS temp dir at depth 3+.
- [x] Missing `pkill`/`pgrep` degrades safely (no throw, no lock deletion).
- [x] Strict `tsc` build passes with exit code 0.
- [x] Offline suites pass with exit code 0.
- [x] `CHANGELOG.md` updated via Parse-Then-Append.
- [x] Diff staged via MCP; task moved to `tasks/qa/`.

## Verification Evidence

- **Test command:** `rtk test npm run build && rtk test npx tsx tests/browser-crash-circuit-tests.ts`
- **Expected result:** tsc exit 0; all crash-circuit checks pass.
- **Actual result:** `tsc` strict build exit 0 (no errors). Crash-circuit suite: `all 49 checks passed`, exit 0 (was 29 before; +20 orphan cleanup checks). grep `cleanupOrphanedFirefox` returns 3 call sites (lines 454, 572, 797) plus definition (line 824). grep `testOrphanCleanup` returns 2 matches (definition + call in main).
- **Exit code:** `0` for both build and tests.

> Verification runner rule: the first verification run used the `rtk test` prefix; recorded above. No raw rerun needed (RTK runs passed).

## Definition of Done

- [x] Build/Test pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded
- [x] No autonomous commit; staged via `custom_context_stage_and_inject_diff`

## Risk & Rollback

- **Risk:** The 2 s in-process wait (Atomics.wait) blocks the event loop during teardown; pkill/pgrep absence degrades cleanup but leaves locks in place.
- **Rollback plan:** Revert the helper methods and their three call sites; restore the previous group-kill block in `clearProcess()`.

---

## Execution Log & Reasoning

- Baseline: `rtk test npm run build` exit 0; `rtk test npx tsx tests/browser-crash-circuit-tests.ts` all 29 checks passed, exit 0. `grep cleanupOrphanedFirefox` = 3 call sites + definition.
- Refactored `src/browshManager.ts`: `isSafeProfilePathForKill`, `hasMatchingProcess`, `hasPkill` now delegate to exported pure helpers (`isSafeProfilePathForKillPath`, `checkMatchingProcess`, `checkPkillAvailable`). Appended `resolveOrphanLockPaths` and `shouldDeleteOrphanLocks`. Replaced inline lockPaths array and three sequential guards with `resolveOrphanLockPaths` + single `shouldDeleteOrphanLocks` policy call preserving distinct log messages.
- Tests: extended `tests/browser-crash-circuit-tests.ts` with `testOrphanCleanup()` (20 checks: allowlist refusal, tool-missing safety via stubbed exec, lock-deletion gate, resolver wiring, timeout mapping, prefix trick). Suite now 49 checks, exit 0.
- Docs: appended `### Orphan Firefox cleanup` subsection to `src/README.md`. `src/DECISIONS.md` already held the two orphan ADRs (verified, not duplicated). `CHANGELOG.md` updated via Parse-Then-Append under `[Unreleased] ### Fixed`.
- QA hotfix applied: tightened `checkMatchingProcess` to return null (skip deletion) on any error except confirmed exit 1 (F1). Skipped 2 s wait when pkill missing (F4). Added `throwTimeout` and allowlist prefix/relative negatives (M1-M3). Escaped regex metacharacters in pkill/pgrep patterns (F2). Fixed dead mozilla lock-sweep path (F3). Suite now 49 checks, exit 0.
- Code Reviewer final verdict: PO_REVIEW_PENDING (technical approval). Manager approved closure.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `14af70697fbad46b4ed3fd1d81de031d890ceecc`
<!-- END_GIT_DIFF -->
