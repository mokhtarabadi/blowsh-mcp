# Task 09: Browsh viewport study (real width lever for http-server-mode)

**File:** `tasks/backlog/09-browsh-viewport-study.md`
**Source:** manager
**Type:** improvement
**Status:** open

## Goal

Find a real, measured way to control render width in Browsh http-server-mode (target 160 columns), or prove conclusively that none exists in the current backend.

## Manager's Notes

Follow-up of the unchecked A3 item from the Browsh hardening task: CLI flags, COLUMNS/LINES env, pty sizing, and binary-string probing all failed to change rendered width. This study starts from that negative evidence (see `tasks/qa/08-browsh-esr-hardening.md` execution log, entries F2-REDUX, F2 WIDTH PTY-LEVER, F2 WIDTH BIN-STRINGS) and looks for a lever that actually works — e.g. newer Browsh release, TTY-mode instead of http-server-mode, Firefox window-size control via Marionette/CDP, or post-render re-wrapping. Manager chose this study over dropping the goal.

## Local TODOs

- [ ] Initial codebase exploration (current Browsh spawn path in `src/browshManager.ts`, http-server-mode request flow)
- [ ] Check newer Browsh releases for viewport/dims support
- [ ] Prototype the most promising lever in Docker and measure rendered width (MAXLEN/LINES on a fixed page)
- [ ] Verify functionality (byte-level before/after comparison, same method as F2-REDUX)

## Acceptance Criteria

- [ ] A measured before/after width comparison exists (same page, same metric as F2-REDUX: LINES + MAXLEN + byte size)
- [ ] Either a working width lever is implemented behind env config, or a written conclusion states no lever exists with evidence
- [ ] No change to MCP tool response shapes except additive fields

## Verification Evidence

- **Test command:** Docker A/B render comparison (COLUMNS/control vs candidate lever) + `npm run build`
- **Expected result:** candidate render measurably wider than control, or documented negative result with numbers
- **Actual result:** _(The Hands fill this during execution)_
- **Exit code:** _(The Hands fill this during execution)_

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [ ] Build/Test/Lint pass with exit code 0
- [ ] `lint_task_file` passes on the active task file
- [ ] `CHANGELOG.md` updated via Parse-Then-Append
- [ ] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** No lever exists (study ends negative); TTY-mode switch could destabilize the render pipeline; larger widths raise token usage.
- **Rollback plan:** Study is read-only by default; any prototype lives on a branch/container tag, production image unchanged until a follow-up implementation task.

---

## Execution Log & Reasoning

_(The Hands: Manually log your technical changes, file edits, and architectural reasoning here BEFORE calling the MCP tool)_

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->

_(Git diff will be automatically injected here by the MCP tool. Do not edit this block manually)_

<!-- END_GIT_DIFF -->
