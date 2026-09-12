# Task 07: Blowsh self-stress fixes (section, verticals, partial search, paper relevance)

**File:** `tasks/completed/07-blowsh-self-stress-fixes.md`
**Source:** manager
**Type:** improvement
**Status:** closed

## Manager Approval (verbatim)

> ببندش منم تایید میکنم یه release هم بدیم

EN: "Close it, I approve too, let's also do a release." — closure + release authorized 2026-09-12. Release prepared as 2.3.2 (PATCH per versioning skill: bug fixes only).

## Goal

Fix the four highest-impact defects found in the live end-to-end stress test of the deployed blowsh MCP server.

## Manager's Notes

Manager ordered in Persian: build a task from the important stress findings, then run on autopilot with Brain planning, execute all steps autonomously, plus a dedicated goal. Autopilot is LOCKED for this task. Scope is exactly the four fixes below (A1, A3, A4, A2 from the stress report). No adjacent refactors. Evidence for each defect comes from real tool outputs recorded 2026-09-12.

**[2026-09-12] [LITE] [EXECUTION-DETECTED]:** Not lite-eligible — multi-file change across search/fetch tools. Full mode applies.

## Acceptance Criteria

- [x] Section extraction returns the body for `Experimental progress` on the surface-code Wikipedia page (was: heading only, empty body)
- [x] Long news/entity queries that returned `[]` now return simplified-fallback web results instead of empty
- [x] Wide code+variants search past deadline returns partial engine results instead of bare `deadline.hit` with zero data
- [x] Paper intent filters withdrawn arXiv entries and ranks title/phrase matches above withdrawn/unrelated ones
- [x] `npm run build` passes with exit code 0 and no new strict-tsc errors

## Verification Evidence

- **Test command:** `npm run build` plus Docker MCP smoke test (initialize → tools/list → tools/call) per AGENTS.md
- **Expected result:** build exit 0; section query returns non-empty body; long news/entity query returns non-empty results; paper query contains no withdrawn entries
- **Actual result:** build exit 0 (tsc clean); live section returned 1052-char body (`The most explicit demonstration of the properties of the toric code...`); long news query returned 3 ranked results (Nature PDF, ar5iv, boots blog); 3s-deadline code query returned 5 cheap-fallback partials (server log confirms); paper output grep: 0 withdrawn/retracted matches, title-matched CRDT papers on top
- **Exit code:** 0 (build); Docker runs EXIT 0 with SIGTERM shutdown after stdin EOF (normal)

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [ ] Build/Test/Lint pass with exit code 0
- [ ] `lint_task_file` passes on the active task file
- [ ] `CHANGELOG.md` updated via Parse-Then-Append
- [ ] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** Search fallback changes alter result ranking for existing simple queries (regression on currently-good baseline).
- **Rollback plan:** Revert the single commit; each phase is a separate hunk set. Baseline simple-query results recorded in stress log serve as regression reference.

## Phase 1: Section extraction empty body (A1)

### Local TODOs

- [x] Locate section-extraction code path for `fetch_web` `section` param
- [x] Reproduce: section `Experimental progress` on surface-code page returns heading only
- [x] Fix sibling traversal for headings with edit-link anchors
- [x] Verify via Docker MCP call

## Phase 2: Verticals fallback for long queries (A3)

### Local TODOs

- [x] Locate news/entity intent query path in search tool
- [x] Add simplification (strip quotes/operators) + fallback retry as `web` intent when vertical returns empty
- [x] Verify: previously-empty long queries return non-empty results; simple queries unchanged

## Phase 3: Partial search results on deadline (A4)

### Local TODOs

- [x] Locate fan-out/deadline handling in `search_web` (code intent + variants path)
- [x] Return partial per-engine results with a truncated flag instead of bare `deadline.hit`
- [x] Verify with the long CRDT/Automerge code+variants query

## Phase 4: Paper relevance — withdrawn filter + ranking (A2)

### Local TODOs

- [x] Locate arXiv/paper intent result mapping
- [x] Filter withdrawn entries; weight title/phrase matches above unrelated ones
- [x] Verify with the Automerge CRDT paper query

## Execution Log & Reasoning

**Autopilot locked** for Task 07 per Manager order (2026-09-12): implement → bridge-QA → fix → bridge-review → stage → qa, zero approval pauses. Relay questions and hard blockers only. ZAC holds (no auto-commit); closure needs explicit approval word.

**Brain plan verdict (2026-09-12, APPROVED TO IMPLEMENT):** order P1 section → P4 paper → P2 verticals fallback → P3 partial deadline (isolated first, orchestration last). Strategies: normalize heading text + rank-compared sibling traversal; withdrawn regex filter + title-weighted ranking; simplifyQuery + empty-only fallback to web; allSettled per-engine partial with truncated flag. Assumptions logged: A1 section bug is in extract.ts traversal; A2 withdrawn signal is in text not a field; A3 empty means `[]` not error (no fallback on error); A4 result type accepts optional `truncated` flag. Selected path: execute P1→P4→P2→P3 per Brain order, confirming real `src/tools/` filenames via grep before editing.

**Execution (2026-09-12):**
- P1 root cause (repro via local node against live Wikipedia HTML): modern Wikipedia wraps headings in `div.mw-heading` (h2 + `span.mw-editsection` as its only siblings). Old sibling walk collected the edit span, its text pushed total past the heading-length check, so the fallback never ran → heading-only output. Fix: `hoistHeading()` climbs wrapper divs, edit spans never collected, document-order fallback walks from the wrapper. Local repro: 320 chars → 9742 chars; toc estimate 9 → 2069 chars. Live Docker: 1052-char body returned.
- P4: `fetchArxivResults` fetches 10, drops `/withdrawn|retract/i`, scores title-phrase(5) > title-token(2 each) > summary-phrase(1), sorts, top 5. Live: 0 withdrawn matches.
- P2: `simplifyQuery()` + empty-only retry (news/entity → simplified → web, one level, `retried` guard). Live long news query: 3 ranked results.
- P3 adaptation (logged deviation from Brain plan): result type is `SearchResult[]` and MCP JSON serialization drops array-attached flags, so no `truncated` field was added — instead the deadline catch runs `fetchCheapFallback()` (plain-HTTP DDG-html + Mojeek, no Browsh) and returns those as normal results; original `deadline.hit` thrown only when fallback is also empty. Live: 3s deadline → 5 partials + server log line. Rationale: same user-visible outcome (data instead of bare error) with zero schema risk.
- Modified files: `src/extract.ts`, `src/tools/searchWeb.ts`, `CHANGELOG.md` (+ task file). `npm run build` exit 0. Docker image rebuilt twice (post-fix verification).
- Environment limits hit: `lint_task_file` and `custom_context_stage_and_inject_diff` MCP tools are not connected in this session — staging/injection must be run by the Manager path. Worktree holds all changes; task moves to qa per Kanban rules.
- **Brain QA verdict (2026-09-12): QA_PASSED** (no reproducing defect; 9 probes reviewed). One accepted tightening: F8 — QA noted `/retract/i` substring could drop a legitimate "Retractable" title. Fixed: regex is now `/\bwithdrawn\b|\bretract(?:ed|ion)?s?\b/i` (word-boundary). Node check: DROPs WITHDRAWN/retracted/retraction, KEEPs Retractable/contraction. Rebuilt: tsc exit 0. QA-suggested extra unit tests (A1-A3) declined with reason: live Docker evidence already covers each behavior; repo test harness additions are scope beyond the AC.
- **Brain Code Reviewer verdict (2026-09-12): technically APPROVED, PO_REVIEW_PENDING.** No blocking defect. Suggestions logged as non-blocking: R1 regex may miss rare withdrawal noun forms (extend only if seen in real results); A1 follow-up task for unit tests (withdrawn filter, empty fallback, wrapped-heading length). Awaiting Manager "Approved for closure" to commit and finish.

_(The Hands: Manually log your technical changes, file edits, and architectural reasoning here BEFORE calling the MCP tool)_

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->

_(Git diff will be automatically injected here by the MCP tool. Do not edit this block manually)_

<!-- END_GIT_DIFF -->
