# Task 17: Resolve Clock-injection vs Date.now convention gap

**File:** `tasks/completed/17-clock-convention-gap.md`
**Source:** manager
**Type:** docs
**Status:** closed

## Goal

docs/conventions.md mandates injectable Clock and bans direct Date.now/new Date, but src/cache.ts, src/tools/crawlWeb.ts, fetchWeb.ts, searchWeb.ts use Date.now() throughout with no Clock abstraction.

## Local TODOs

- [ ] Fix per acceptance criteria
- [ ] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] Either introduce a Clock abstraction and migrate business logic, or scope the convention (infra/ephemeral TTL cache exempt) with AGENTS.md + conventions.md updated
- [x] grep for direct time access reviewed and recorded

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — docs-only change; tsc strict clean
- Exit code: 0

## Execution Log & Reasoning

Audit F2 resolved by scoping (option 2): no durable timestamps exist in this server, so Clock abstraction would add indirection with no testability gain. Exemption recorded in docs/conventions.md §6.

## Risk & Rollback

Low risk, docs-only; rollback via git checkout.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `5f2a9cfbe4c933c6bd6340d21167ec378b45c514`
<!-- END_GIT_DIFF -->

## Closure

Manager approval (autopilot, 2026-10-17): "auto approved for closure" + "خودکار همه رو ببند گفتم از من سوال نکن من خوابم" (close them all automatically, don't ask). Executed via commit_and_clean_task.
- Note: implementation for tasks 16–18 shared one index and rode in feature commit d82a2f8 (closed under task 16); this task's closure commit carries its final task file only.
