# Task 05: Release v2.2.1 — Bug Fixes and Improvements

**File:** `tasks/backlog/05-release-v221-bugfixes.md`
**Source:** manager
**Type:** feature
**Status:** open

## Goal

Release v2.2.1 containing all verified bug fixes and improvements from Task 04 and the post-deployment verification session. This is a PATCH release (bug fixes only, no breaking changes).

## Manager's Notes

- All 4 fixes have been verified working in the deployed Docker image
- Auto-approve closure — skip normal QA/review flow
- Commit, tag, and push in one sequence

## Acceptance Criteria

- [ ] Version bumped to 2.2.1 in package.json
- [ ] CHANGELOG.md updated with all fixes
- [ ] All 4 modified files committed
- [ ] Git tag v2.2.1 created
- [ ] Changes pushed to origin

## Verification Evidence

- **Test command:** `npm run build && git log --oneline -1`
- **Expected result:** Build passes, commit exists with conventional message
- **Actual result:** _(filled during execution)_
- **Exit code:** _(filled during execution)_

## Definition of Done

- [ ] Build pass with exit code 0
- [ ] CHANGELOG.md updated
- [ ] Commit created with conventional message
- [ ] Tag created

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

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `200bb81495e97df40cdcc0185bbffc9ce56da5ca`
<!-- END_GIT_DIFF -->
