# Task 21: QA follow-up locks (Hebrew/CJK, wrapper-div, typing)

**File:** `tasks/completed/21-qa-followup-locks.md`
**Source:** manager
**Type:** bugfix
**Status:** closed
**Mode:** autopilot (locked 2026-10-19)

## Goal

Close the non-blocking QA/Review follow-ups from task 20: Hebrew/CJK locks (M1), wrapper-div multi-lang fixture (M2), monolingual ranking preservation lock (M3), proper Cheerio typing for `langBonus` (R1).

## Context

Task 20 QA_PASSED + Review APPROVED with noted follow-ups: V1 untagged pages fall back to length ranking (by design — lock it), V2 wrapper div containing all languages can outscore a single lang-matched paragraph (fix: mixed-language containers get no lang bonus), V3 2-char token filter (by design — lock it), V4 `$(el as never)` obscure cast (R1: type properly).

## Local TODOs

- [x] Mixed-language container penalty in `extractMainHtml` (no bonus when descendants carry a different explicit `lang`)
- [x] Proper Element typing for `langBonus`
- [x] Hebrew/CJK + wrapper-div + monolingual locks in regression tests
- [x] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] Wrapper with mixed langs loses to lang-matched paragraph
- [x] Hebrew/CJK queries yield tokens; 2-char filter behavior locked
- [x] Monolingual no-lang ranking preserved (first/longest wins)
- [x] Existing suites stay green, `npm run build` passes

## Definition of Done

- [x] Fix in `src/extract.ts` (+ tests)
- [x] CHANGELOG.md entry added

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: TBD
- Exit code: TBD

## Execution Log & Reasoning

2026-10-19 [AUTOPILOT] [PLAN]: Brain blueprint approved (mixed-lang penalty + Element typing + locks).
2026-10-19 [AUTOPILOT] [EXECUTION]: red proof first (wrapper leaks Russian), then mixed-lang container penalty + `domhandler` Element typing in `src/extract.ts`. Suites: multilingual 17/17, hardening 9/9, parser 11/11. `npm run build` exit 0 verified unpiped (pipes mask tsc failures — caught a real TS2305 this way).
2026-10-19 [PO_REVIEW_PENDING]: QA PASSED + Code Reviewer APPROVED technically (17+9+11 green, build clean, untagged-wrapper bypass closed). Reviewer note (non-blocking, future touch-up): `let langs` can be `const`. Manager accept quote: "Approved for closure".

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — tsc strict clean (unpiped exit 0); multilingual 17/17, hardening 9/9, parser 11/11
- Exit code: 0

## Risk & Rollback

Low risk, scorer-only change. Rollback via git checkout of `src/extract.ts`.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `8031e6ee39aa9ce867b6e70db009a51f078be5ff`
<!-- END_GIT_DIFF -->
