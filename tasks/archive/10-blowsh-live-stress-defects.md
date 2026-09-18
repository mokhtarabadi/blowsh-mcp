# Task 10: Blowsh live-stress defects (batch timeout, archive fallback, deadline contract)

**File:** `tasks/completed/10-blowsh-live-stress-defects.md`
**Source:** manager
**Type:** bug
**Status:** closed

## Goal

Reproduce and fix three live-stress defects found in the 2026-09-17 audit against `ghcr.io/mokhtarabadi/blowsh-mcp:latest`: batch render timeout, archive=auto not rescuing a failed fetch, and search deadline contract deviation.

## Manager's Notes

Evidence comes from real MCP calls in-session (no code reads yet). Single fetch_web on the Wikipedia MCP page succeeded (focus/toc/must_contain/section all OK), but fetch_web_batch on the same URL returned "Browsh rendering aborted after 30s timeout" for that item while per-URL SSRF isolation worked correctly for the loopback item. fetch_web with archive=auto on a nonexistent example.com path returned a plain 30s timeout with no Wayback rescue label. search_web with deadline_ms=500 returned [] instead of the documented deadline.hit error. Decide each: real bug to fix, or contract/docs correction.

<!-- These sections are unconditional per lint contract — DO NOT move back inside variants -->

## Local TODOs

- [x] Repro D1: single fetch_web vs fetch_web_batch on the heavy Wikipedia page; check Browsh mutex/sequential render path
- [x] Repro D2: archive=auto on 404/timeout; verify whether timeouts classify as hard failures for Wayback fallback
- [x] Repro D3: search_web with deadline_ms=500 on a broad query; verify deadline.hit vs empty success
- [x] Fix or correct contract + docs for each confirmed item
- [x] Verify functionality via live Docker smoke

## Acceptance Criteria

- [x] D1 resolved: batch either renders the heavy page or returns an honest per-URL error with retry guidance (no silent success-string)
- [x] D2 resolved: archive=auto behavior on 404 AND timeout is defined and observed (rescue label or honest archive.stale)
- [x] D3 resolved: search deadline expiry surfaces deadline.hit (or docs corrected if [] is intended partial behavior)
- [x] No regression in single-fetch, SSRF isolation, since_last, offset, selector/section error paths

## Verification Evidence

- **Test command:** rtk test docker run --rm -i blowsh-mcp:task10 (MCP initialize → tools/list → tools/call smoke)
- **Expected result:** smoke passes; D1/D2/D3 repros show defined behavior above
- **Actual result:** PASS — `npm run build` exit 0 (tsc strict); new `npx tsx tests/task10-stress-fixes.ts` 18/18 pass; existing suites green (parity 26/26, boundary ALL PASS, guard ALL PASS). Live Docker `blowsh-mcp:task10`: D3 search deadline 500ms → 5 cheap-fallback partials + stderr `deadline.hit — returning 5 cheap-fallback partial results` (was bare `[]`); D1 batch `[example.com ok:true + 127.0.0.1 ok:false SSRF]` envelope `isError:false` with per-item `deadline_ms:20000` passthrough; D2 `archive=only` on bogus URL → honest `archive.stale` + stderr `Wayback: api-error ... 429` (miss class now logged, was silent null).
- **Exit code:** 0
- **Reviewer-fix-2 docs evidence:** `npm run build` exit 0 (no source change, docs-only); `git diff --check` exit 0 (no whitespace errors). Label `(Task 10)` removed from `docs/data_model.md` precedence note; CHANGELOG Unreleased/Fixed entry added.

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** Browsh render-path changes could destabilize single-fetch reliability
- **Rollback plan:** Revert render-path edits; keep contract/docs-only fix if behavior change is risky

---

## Execution Log & Reasoning

**[2026-09-17] [HOTFIX] [REVIEWER-FIX]:** Code Review APPROVED_WITH_CHANGES (F1 medium, F2 low-medium). Reviewer APPROVED_WITH_CHANGES (F1 medium, F2 low-medium). F1: wrapped snapshot download in nested try/catch in fetchWaybackOutcome (axios non-2xx rejections now map to snapshot-fetch-failed; outer catch stays availability-only); removed dead status>=400 check; added pure classifySnapshotBody() helper used by the body gate. F2: added typed optional `code` to FetchError; createDeadlineError/isDeadlineHitError use declared field, zero casts. Tests: 4 new checks (url+code shape, 3 body-classifier branches incl. not-api-error assertion); updated code assertion to direct .code access. Assumption A2: snapshot transport-failure branch verified by structure + live api-error/no-snapshot logs (offline suite cannot reach network); no repo mocking style exists.
- **Hotfix verification:** build exit 0; tsc --noEmit exit 0; new suite 22/22; parity 26/26; boundary ALL PASS; guard ALL PASS. Docker rebuilt blowsh-mcp:task10. Live: D3 deadline 500ms returns partials (fallback works despite Browsh segfault flake in container); D2 archive=only bogus URL returns honest archive.stale + stderr Wayback api-error (nested boundary correct: availability failure stays api-error).

**[2026-09-17] [REVIEWER-FIX-2 DOCS]:** Code Review APPROVED_WITH_CHANGES (F1 Low): `docs/data_model.md` exposed internal label `(Task 10)` in the deadline precedence note — removed the label only, rule text unchanged. CHANGELOG Unreleased/Fixed entry added. No source code changed.
- **Reviewer-fix-2 verification:** build exit 0; `git diff --check` exit 0 (recorded below).

**[2026-09-17] [EXECUTION-DETECTED]:** Audit evidence logged by audit session. Single-fetch OK; batch item timed out (30s Browsh abort). archive=auto timeout had no rescue label. search deadline 500ms gave [] not deadline.hit. All need repro before claiming bug vs contract.

**[2026-09-17] [PLAN]:** Seat Check: batch-timeout/mutex → Senior Programmer; archive/deadline contract → Software Architect; both hit = 2-seat consult. Brain turn 1 returned discovery task (executed via 4 subagents A-D, report context-reports/task-10-context.md). Brain turn 2 (final) verdicts: D1 real runtime bug (mutex wait consumes render timeout; per-URL isolation), D2 runtime bug + contract gap (Wayback silent null; auto-miss rethrow; 11 dropped opts), D3 real bug (inner abort→[] wins race; variants catch→[]). Plan: browshManager timer-after-acquire; batch isolation; server.ts option forwarding; archive classification 404+timeout; deadline.hit propagation; stubbed npx tsx tests; docs+CHANGELOG sync. Manager replied "Approved".

**[2026-09-17] [IMPLEMENT]:** Manager-approved plan executed. Assumption A1 (logged, checkable): code read shows the axios render timeout (`browshManager.ts:304-308`) is created AFTER mutex acquisition (`fetchRaw:266` → `fetchRawInner:302`), so the timer already measures the render, not the mutex wait — per the plan's own confirm-before-editing gate, NO mutex/timer surgery was done (also honors Risk: render-path stability). What shipped instead:
- D1: transport timeouts carry transient-retry hint + URL attribution (`browshManager.ts:356-368`); batch keeps sequential per-URL isolation and gains per-item `deadline_ms` passthrough (`fetchWebBatch.ts`, `server.ts:179-185`+route); other 10 opts stay single-fetch-only, now documented in the tool description + `data_model.md`.
- D2: `fetchWaybackSnapshot` → outcome-aware `fetchWaybackOutcome` (`hit|no-snapshot|snapshot-fetch-failed|api-error`) with stderr log per miss class; pure `classifyWaybackAvailability` exported; `isHardFailure` exported unchanged (timeout already hard; `deadline.hit` stays non-hard, documented); `server.ts:45` description now lists timeout/network.
- D3: `isEmptyResultDeadline()` precedence (aborted + empty + no instant answer + deadline set → throw typed `deadline.hit` before news/entity simplify-retry); variants `.catch` rethrows `isDeadlineHitError`; shared `createDeadlineError/isDeadlineHitError/DEADLINE_HIT_CODE` in `errors.ts` used by both fetch + search wrappers.
- Tests `tests/task10-stress-fixes.ts` (18 checks, offline: SSRF-blocked URLs for batch isolation, pure helpers for the rest). Docs: `data_model.md` precedence rule + archive miss semantics + batch table; `CHANGELOG.md` Unreleased/Fixed entries; `server.ts` search/batch descriptions.
- Replay note: no stored decision covered the mutex-timer deviation; decided from code evidence + task Risk section, logged here for Manager audit.

**[2026-09-18] [CLOSURE]:** Manager accept quote: "Approved for closure". Reviewer APPROVED (F1 Low docs fix applied+staged). Closed to tasks/completed/.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `22974a50195721c5d5eda7cb47d5163268f464ee`
<!-- END_GIT_DIFF -->
