# Milestone 5 Summary

**Date:** 2026-11-25
**Tasks Compacted:** 2

## Source Distribution

| Source       | Count |
| ------------ | ----- |
| orchestrator | 0     |
| telegram     | 0     |
| manager      | 2     |

## Architectural Changes

- **Orphan Firefox cleanup (Task 270):** `clearProcess()` now sweeps orphaned Firefox for the Browsh profile on teardown, spawn, and unexpected exit. Allowlisted profile paths (`/data` or `os.tmpdir()` at depth 3+); pkill TERM → 2 s wait → KILL; lock files deleted only when pgrep confirms no process references the profile. Missing pkill/pgrep degrade safely. Exported pure helpers (`isSafeProfilePathForKillPath`, `resolveOrphanLockPaths`, `checkPkillAvailable`, `checkMatchingProcess`, `shouldDeleteOrphanLocks`) with regex escaping. Two new ADRs in `src/DECISIONS.md`. Regression coverage: 49 checks in `tests/browser-crash-circuit-tests.ts`.
- **Release v2.9.1 (Task 271):** patch version bump across `package.json`, `package-lock.json`, `src/server.ts`, `AGENTS.md`, `docs/architecture.md`; CHANGELOG stamped `[2.9.1] - 2026-11-25`. Tag `v2.9.1` pending Manager push.

## Files Modified

| File | Change |
| --- | --- |
| `src/browshManager.ts` | Orphan Firefox cleanup helpers + 3 call sites + safety fixes |
| `src/DECISIONS.md` | Two new ADRs (allowlisted/gated cleanup; tool-missing safety) |
| `src/README.md` | Restored paragraph + orphan cleanup subsection |
| `tests/browser-crash-circuit-tests.ts` | +20 orphan cleanup regression checks (49 total) |
| `CHANGELOG.md` | Task 270 entry + 2.9.1 release stamp |
| `package.json` | 2.9.0 → 2.9.1 |
| `package-lock.json` | 2.9.0 → 2.9.1 |
| `src/server.ts` | 2.9.0 → 2.9.1 |
| `AGENTS.md` | 2.9.0 → 2.9.1 |
| `docs/architecture.md` | 2.9.0 → 2.9.1 (current refs) |

## Criteria Met

| Task | Acceptance Criteria | Status |
| --- | --- | --- |
| 270 | clearProcess sweeps orphaned Firefox; allowlist refusal; missing tools safe; tsc exit 0; 49/49 checks; CHANGELOG updated; staged | ✅ Met |
| 271 | Version files report 2.9.1; CHANGELOG dated 2.9.1; build exit 0; staged | ✅ Met |

## Individual Task Summaries

### Task 270: Orphan Firefox cleanup for Browsh profile locks

- **Type:** bug
- **Source:** manager
- **Reasoning:** Prevented stale Firefox profile lock from breaking renders after Browsh crash. Exported pure helpers with allowlist and pgrep gate; tightened error mapping (only exit 1 allows deletion); escaped regex; fixed dead mozilla sweep path; 49 regression checks pass.

### Task 271: Release v2.9.1

- **Type:** feature
- **Source:** manager
- **Reasoning:** Patch release from Task 270. Bumped all version identifiers, stamped CHANGELOG, build exit 0, QA and Code Reviewer approved. Tag pending Manager push.
