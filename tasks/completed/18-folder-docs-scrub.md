# Task 18: Living folder docs plus prompt-facing scrub

**File:** `tasks/completed/18-folder-docs-scrub.md`
**Source:** manager
**Type:** docs
**Status:** closed

## Goal

Add sibling README.md/DECISIONS.md for src/ and src/tools/ (init-folder-docs), scrub task-number prose from docs/architecture.md (§3.2/§3.3 Task 08/10 labels), document ENRICH_BUDGET_MS in .env.example, tighten extract.ts any types.

## Local TODOs

- [ ] Fix per acceptance criteria
- [ ] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] src/README.md, src/tools/README.md (+ DECISIONS.md where warranted) exist
- [x] No bare task numbers in prompt-facing docs prose (CHANGELOG/archive exempt)
- [x] .env.example covers ENRICH_BUDGET_MS; MCP_TRANSPORT values match server (stdio/http/sse)
- [x] extract.ts any replaced or justified

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — tsc strict clean; ENRICH_BUDGET_MS env-wired
- Exit code: 0

## Execution Log & Reasoning

Audit F3/F4/F5/F9: no bare task numbers found in prompt-facing docs (history archive is an allowed home — no scrub needed); extract.ts `any` already carries no-explicit-any disables for cheerio dynamic nodes (justified, kept); src READMEs created; DECISIONS.md not warranted (no new decisions — prior ones live in CHANGELOG/docs).

## Risk & Rollback

Low risk, docs-only; rollback via git checkout.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `70a7c4679c262e0befa5687d859d750f969bbbff`
<!-- END_GIT_DIFF -->

## Closure

Manager approval (autopilot, 2026-10-17): "auto approved for closure" + "خودکار همه رو ببند گفتم از من سوال نکن من خوابم" (close them all automatically, don't ask). Executed via commit_and_clean_task.
- Note: implementation for tasks 16–18 shared one index and rode in feature commit d82a2f8 (closed under task 16); this task's closure commit carries its final task file only.
