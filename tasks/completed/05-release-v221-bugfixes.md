# Task 05: Release v2.2.1 — Bug Fixes and Improvements

**File:** `tasks/qa/05-release-v221-bugfixes.md`
**Source:** manager
**Type:** feature
**Status:** in-review

## Triage Verdict (2026-09-18 — approved rebase-or-drop check)

Manager-approved plan: check each of the 4 fixes in current source. Result: ALL FOUR PRESENT, COMMITTED, TAGGED, PUSHED. No rebase needed. No code changes made by this triage.

## Goal

Release v2.2.1 containing all verified bug fixes and improvements from Task 04 and the post-deployment verification session. This is a PATCH release (bug fixes only, no breaking changes).

## Manager's Notes

- All 4 fixes have been verified working in the deployed Docker image
- Auto-approve closure — skip normal QA/review flow
- Commit, tag, and push in one sequence

## Acceptance Criteria

- [x] Version bumped to 2.2.1 in package.json (done at release time; now at 2.3.2 via later releases)
- [x] CHANGELOG.md updated with all fixes (## [2.2.1] entry present)
- [x] All 4 modified files committed (commit 200bb81, on origin/main)
- [x] Git tag v2.2.1 created (exists locally and on origin per ls-remote)
- [x] Changes pushed to origin (origin/main contains 200bb81)

## Verification Evidence

- **Test command:** `npm run build && git log --oneline -1`
- **Expected result:** Build passes, commit exists with conventional message
- **Actual result:** Triage 2026-09-18, no code changes: (1) Bing a1 strip present src/tools/searchWeb.ts:55,74; (2) min-indent strip present src/browshManager.ts:52-64; (3) no maxContentLength on sniff GET fallback per src/tools/fetchWeb.ts:94; (4) scoring link ranking present src/tools/extractLinks.ts:44-160. Commit 200bb81 in history and in origin/main. Tag v2.2.1 local + remote. CHANGELOG ## [2.2.1] at line 74.
- **Exit code:** 0 (grep + git checks; build untouched — no source changes)

## Definition of Done

- [x] Build pass with exit code 0 (no source changes; last full build exit 0 on task 10 hotfix)
- [x] CHANGELOG.md updated (## [2.2.1] entry present since release)
- [x] Commit created with conventional message (200bb81 fix: v2.2.1 — conventional)
- [x] Tag created (v2.2.1 local + remote)

## Local TODOs

- [x] Check fix 1 (Bing a1 strip) in current source
- [x] Check fix 2 (min-indent strip) in current source
- [x] Check fix 3 (no maxContentLength) in current source
- [x] Check fix 4 (link scoring) in current source
- [x] Confirm commit, tag, CHANGELOG, remote push

## Risk & Rollback

- **Risk:** Push may fail if remote has updates
- **Rollback plan:** `git reset --hard HEAD~1` and `git tag -d v2.2.1`

---

## Execution Log & Reasoning

### Files Modified (uncommitted)

- `src/tools/searchWeb.ts` — Bing `a1` prefix stripping in `decodeRedirect()`
- `src/browshManager.ts` — min-indent stripping in `cleanPlainText()`
- `src/tools/fetchWeb.ts` — removed `maxContentLength:0` from sniff GET fallback
- `src/tools/extractLinks.ts` — scoring-based link ranking with URL+text heuristics

### Verification

- All 4 fixes verified working via MCP tool tests against deployed Docker image

### Triage (2026-09-18, Manager-approved rebase-or-drop plan)

- Checked each fix in current source: all four present (searchWeb.ts:55,74; browshManager.ts:52-64; fetchWeb.ts:94; extractLinks.ts:44-160).
- Commit 200bb81 on origin/main; tag v2.2.1 local + remote; CHANGELOG entry present.
- Conclusion: release v2.2.1 already shipped. Task closed as already-done. Zero source changes.

### QA + Review (2026-09-18)

- Brain QA: QA_PASSED (drop verdict sound; release evidence verified; no tests required for triage task).
- Brain Reviewer: APPROVED + PO_REVIEW_PENDING (no issues, no blocking findings).

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
No code changes detected or staged.
```
<!-- END_GIT_DIFF -->
