# Task 13: Release v2.5.0

**File:** `tasks/completed/13-release-v250.md`
**Source:** manager
**Type:** feature
**Status:** closed

## Goal

Cut release v2.5.0 (minor: Task 10 singleton HTTP/SSE transport + hardening): bump version, stamp CHANGELOG, build, commit, tag `v2.5.0`, push, watch CI/CD, upgrade the published image.

## Manager's Notes

- Manager ordered on 2026-09-29: read memory, do everything needed for a release, archive tasks, create milestone, create release task, do all work, hand push/pipeline commands to Manager for manual execution.
- Memory check 2026-09-29: searched `release version milestone archive` + `config docker ghcr`, listed namespaces (`config-quirks`, `v211-bugfix-quirks`) — no relevant stored rules.
- Release flow: archive Task 10 → milestone v2.5.0 → bump → stamp CHANGELOG → build → stage/inject → QA/review → close → push commands for Manager → wait CI/CD → upgrade docker image → smoke test.
- ZAC: no autonomous `git commit`/`push`; commits only via `commit_and_clean_task`, push/tag commands are Manager-owned.

## Local TODOs

- [x] Bump `package.json` + `src/server.ts` version to 2.5.0
- [x] Stamp CHANGELOG `[Unreleased]` → `[2.5.0] - 2026-09-29`
- [x] Build (`npm run build`) exit 0
- [x] Archive Task 10 to `tasks/archive/`
- [x] Create GitHub milestone v2.5.0
- [x] Stage + inject diff, QA + review via Brain
- [ ] Hand push/tag/CI commands to Manager

## Acceptance Criteria

- [x] `package.json` and server-reported version are 2.5.0
- [x] CHANGELOG has a dated `[2.5.0]` section, no `[Unreleased]` leftovers for shipped items
- [x] `npm run build` exits 0
- [x] Task 10 archived, milestone v2.5.0 exists
- [ ] Tag `v2.5.0` push commands handed to Manager (Manager pushes)

## Verification Evidence

- **Test command:** rtk test npm run build
- **Expected result:** tsc strict passes, exit 0
- **Actual result:** PASS — `rtk test npm run build` exit 0 (tsc strict, no errors); milestone v2.5.0 created (number 2, open); Task 10 moved to `tasks/archive/`
- **Exit code:** 0

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** ghcr push needs CI `packages: write` (fine); manual docker push needs token scope Manager may lack.
- **Rollback plan:** delete tag `v2.5.0` locally + remote, revert version commits, keep image at previous tag.

---

## Execution Log & Reasoning

**[2026-09-29] [EXECUTION-DETECTED]:** Bumped `package.json` + `src/server.ts` 2.4.0 → 2.5.0, stamped CHANGELOG `[Unreleased]` → `[2.5.0] - 2026-09-29` (minor: new singleton HTTP/SSE transport feature). `rtk test npm run build` exit 0. Archived Task 10 (`tasks/completed/` → `tasks/archive/10-native-http-transport.md`; note: archive already holds a different ID-10 file, active-dir duplicate check clean). Created GitHub milestone v2.5.0 (number 2, open; v2.4.0 milestone 1 still open, left untouched). `lint_task_file` clean.

**[2026-09-29] [QA]:** Brain QA verdict QA_PASSED — versions consistent (2.5.0), CHANGELOG dated with no Unreleased residue, build exit 0, release-only diff with no runtime risk.

**[2026-09-29] [REVIEW]:** Code Reviewer APPROVED, PO_REVIEW_PENDING. Release-only diff, SemVer minor correct, ZAC holds. Awaiting Manager explicit closure phrase.

**[2026-09-29] [CLOSURE]:** Manager replied "Approved for closure". Moving to completed with no further code changes.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `ed3c3779536770029075f3d1d96aacee26e54796`
<!-- END_GIT_DIFF -->
