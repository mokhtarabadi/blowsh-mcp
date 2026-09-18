# Task 12: Release v2.4.0

**File:** `tasks/in-progress/12-release-v240.md`
**Source:** manager
**Type:** feature
**Status:** open

## Goal

Cut release v2.4.0 (minor: behavior-affecting Task 10 fixes + Task 11 docs): bump version, stamp CHANGELOG, build, commit, tag `v2.4.0`, push, watch CI/CD, upgrade the published image.

## Manager's Notes

- Manager agreed to 2.4.0 and ordered a task file with current working-tree changes injected.
- Release flow: milestone → release → push commands for Manager → wait CI/CD → upgrade docker image → restart opencode → smoke test.
- Working-tree changes at task creation: `.gitignore` (tasks/.sessions/ audit fix), `opencode.json` (LSP wrapper schema fix).

## Local TODOs

- [ ] Bump `package.json` + `src/server.ts` version to 2.4.0
- [ ] Stamp CHANGELOG `[Unreleased]` → `[2.4.0] - 2026-09-18`
- [ ] Build (`npm run build`) exit 0
- [ ] Create GitHub milestone v2.4.0
- [ ] Stage + inject diff, hand push commands to Manager
- [ ] Watch CI/CD run to success
- [ ] Upgrade docker image, restart opencode, smoke test

## Acceptance Criteria

- [ ] `package.json` and server-reported version are 2.4.0
- [ ] CHANGELOG has a dated `[2.4.0]` section, no `[Unreleased]` leftovers for shipped items
- [ ] `npm run build` exits 0
- [ ] Tag `v2.4.0` pushed, CI workflow green, ghcr image published
- [ ] Local docker image upgraded and MCP smoke test passes

## Verification Evidence

- **Test command:** rtk test npm run build
- **Expected result:** tsc strict passes, exit 0
- **Actual result:** _(The Hands fill this during execution)_
- **Exit code:** _(The Hands fill this during execution)_

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [ ] Build/Test/Lint pass with exit code 0
- [ ] `lint_task_file` passes on the active task file
- [ ] `CHANGELOG.md` updated via Parse-Then-Append
- [ ] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** ghcr push needs CI `packages: write` (fine); manual docker push needs token scope Manager may lack.
- **Rollback plan:** delete tag `v2.4.0` locally + remote, revert version commits, keep image at previous tag.

---

## Execution Log & Reasoning

**[2026-09-18] [EXECUTION-DETECTED]:** Bumped `package.json` + `src/server.ts` to 2.4.0, stamped CHANGELOG `[2.4.0] - 2026-09-18`. `npm run build` (tsc strict) exit 0, no errors. `lint_task_file` passes. Working-tree strays absorbed: `.gitignore` (tasks/.sessions/ audit fix) + `opencode.json` (LSP wrapper schema fix, validator exit 0).

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->

_(Git diff will be automatically injected here by the MCP tool. Do not edit this block manually)_

<!-- END_GIT_DIFF -->
