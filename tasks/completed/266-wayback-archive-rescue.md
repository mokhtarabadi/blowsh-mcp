# Task 266: Wayback archive rescue silently fails when the availability API times out

**File:** `tasks/completed/266-wayback-archive-rescue.md`
**Source:** manager
**Type:** bug
**Status:** closed
**Finished:** 2026-11-26T00:14:52Z
**Submitted:** 2026-11-26T00:08:10Z
**Started:** 2026-11-25T23:54:30Z

## Source Context

### Variant C: Manager (`**Source:** manager`)

## Goal

Make `archive: "auto"` and `archive: "only"` actually rescue dead or failed fetches. Today the rescue reports "no snapshot" for URLs that are demonstrably archived, because the Wayback availability API returns a transient timeout payload that the classifier reads as a genuine miss. Replace or supplement the availability lookup with a reliable one (CDX), distinguish "no snapshot" from "API failed", and verify the rescue end to end.

## Manager's Notes

Found while answering the capability question ("can it gather everything?"). The Manager asked to "create backlog task for 1 item, and enough for today" — so this is scoped and queued, not executed now.

### Reproduction (verified against the running container)

`archive: "only"` on a URL that definitely has thousands of snapshots:

```
blowsh.fetch_web({ url: "https://www.yahoo.com", type: "markdown", archive: "only" })
→ FetchError: archive.stale: no Wayback snapshot for https://www.yahoo.com [archive=only]
```

Raw availability API from inside the container:

```
$ docker exec blowsh-singleton node -e "... fetch('https://archive.org/wayback/available?url=' + encodeURIComponent(u))"
https://www.yahoo.com    -> NO SNAPSHOT {"code":"timeout","message":"client timeout at 5.0 seconds"}
https://example.com      -> SNAPSHOT 20261113005606
https://www.wikipedia.org-> SNAPSHOT 20261111025218
```

Note the payload shape: HTTP **200**, `archived_snapshots: {}` empty, plus an `error` object. `classifyWaybackAvailability` (`src/tools/fetchWeb.ts:218-223`) only inspects `archived_snapshots.closest`, so it sees nothing and returns `"no-snapshot"` — an API failure is reported as a genuine miss.

### Root cause (diagnosed, not guessed)

1. **The availability API is unreliable for popular URLs.** It returned `client timeout at 5.0 seconds` for `yahoo.com` — the timeout is the API's own server-side budget, not ours, so raising our `axios` timeout does not help.
2. **The classifier cannot tell failure from absence.** It ignores the `error` field entirely, so both cases collapse to `"no-snapshot"`.
3. **`isHardFailure` never sees a status code.** Browsh answers HTTP 200 for everything, so `e.statusCode` is undefined and the rescue depends entirely on message matching.

### Verified alternative (the fix path)

Two working endpoints, both tested from inside the container:

```
# CDX API — returns the real archived timestamp
GET https://web.archive.org/cdx/search/cdx?url=<u>&output=json&limit=1&filter=statuscode:200&fl=timestamp,original
→ [["timestamp","original"], ["19961017235908","http://www2.yahoo.com:80/"]]

# Direct redirect — also works
GET https://web.archive.org/web/2024/<u>   (redirect: 'manual')
→ 302  location: https://web.archive.org/web/20250101000642/https://www.yahoo.com/
```

CDX is the better primary: it returns a precise timestamp and supports filters, so it can pick a 200-status snapshot rather than any snapshot.

### Out of scope

- **HTTP status reporting** (Browsh answers 200 for everything). Separate decision, needs an extra request per fetch; the Manager has not chosen a trade-off.
- **Interaction (click/type/press)**. Browsh 1.8.0 exposes no such endpoint; verified by inspecting the binary for route strings. A Playwright/Puppeteer backend is a separate project phase.

## Local TODOs

- [x] Fix `classifyWaybackAvailability` to read the `error` field and return `"api-error"` instead of `"no-snapshot"` on a transient failure
- [x] Add the CDX endpoint as the reliable fallback, keeping availability as the fast path
- [x] Make the rescue retry once on a transient API failure before giving up
- [x] Verify `isHardFailure` triggers the rescue for an abort-notice/empty-extraction failure (message-based path)
- [x] Add regression tests for: timeout payload → `api-error`, empty snapshots → `no-snapshot`, real CDX hit → `hit`, snapshot body too small → `snapshot-fetch-failed`
- [x] Verify live: `archive: "only"` and `archive: "auto"` rescue a dead URL
- [x] Update `docs/data_model.md`, `CHANGELOG.md`, and `src/tools/DECISIONS.md`; `DESIGN.md` unchanged because no error text changed

## Acceptance Criteria

- [x] `classifyWaybackAvailability` returns `api-error` (not `no-snapshot`) when the payload carries an `error` object or the snapshot list is empty with an error.
- [x] The rescue uses CDX as its reliable fallback and resolves a real timestamp for a URL the availability API times out on (regression case: `https://www.yahoo.com`).
- [x] A transient API failure is retried once before the rescue gives up.
- [x] `archive: "only"` on a genuinely archived URL returns the archived content with the `> [archive snapshot from ...]` banner.
- [x] `archive: "only"` on a URL with no snapshot anywhere still throws `archive.stale` (unchanged contract).
- [x] `archive: "auto"` rescues a failed live fetch when a snapshot exists, and rethrows the original error when none does.
- [x] No existing test regresses: `npm run build` exits 0 and all `tests/*.ts` suites exit 0.

## Verification Evidence

- **Test command:** `rtk test npx tsx tests/task10-stress-fixes.ts`
- **Expected result:** RED confirmation after adding CDX imports and regression checks, before implementation.
- **Actual result:** Exit 1 with `SyntaxError: The requested module '../src/tools/fetchWeb.js' does not provide an export named 'classifyCdxPayload'`. Full diagnostic retrieved with `rtk recall feddd862ed78ae51`.
- **Exit code:** 1

- **Test command:** `rtk test npx tsx tests/task10-stress-fixes.ts`
- **Expected result:** GREEN confirmation for classifier, CDX, retry, snapshot-body, deadline, and empty-extraction behavior.
- **Actual result:** 31 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npm run build`
- **Expected result:** strict TypeScript compilation succeeds.
- **Actual result:** `tsc` completed with no errors.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/proxy-config-tests.ts`
- **Expected result:** no proxy regression.
- **Actual result:** 17/17 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/search-timeout-hardening-tests.ts`
- **Expected result:** no timeout-ladder regression.
- **Actual result:** 52 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/browser-crash-circuit-tests.ts`
- **Expected result:** no browser lifecycle regression.
- **Actual result:** 49 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/empty-extraction-guard-tests.ts`
- **Expected result:** empty-extraction contract remains intact.
- **Actual result:** all checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/guard-detector-tests.ts`
- **Expected result:** bot-guard behavior remains intact.
- **Actual result:** all guard-detector tests passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/qa-boundary-tests.ts`
- **Expected result:** cache, offset, fingerprint, and SSRF boundaries remain intact.
- **Actual result:** all checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/search-engine-parser-tests.ts`
- **Expected result:** search parser behavior remains intact.
- **Actual result:** 11 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/search-parser-hardening-regression.ts`
- **Expected result:** parser hardening remains intact.
- **Actual result:** 9 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/multilingual-relevance-guard-regression.ts`
- **Expected result:** multilingual relevance behavior remains intact.
- **Actual result:** 17 checks passed.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/verify-donsetch-parity.ts`
- **Expected result:** offset parity remains intact.
- **Actual result:** 26 passed, 0 failed.
- **Exit code:** 0

- **Test command:** `rtk test docker build -t blowsh-mcp:wayback-test .`
- **Expected result:** runtime image builds with the new archive rescue code.
- **Actual result:** Docker image built successfully.
- **Exit code:** 0

- **Test command:** `rtk test docker exec blowsh-singleton node -e "fetch('https://web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fwww.yahoo.com&output=json&limit=1&filter=statuscode%3A200&fl=timestamp%2Coriginal').then(async r=>{const t=await r.text(); console.log(t.slice(0,500));})"`
- **Expected result:** CDX returns a real successful snapshot for Yahoo.
- **Actual result:** `[["timestamp","original"],["19961017235908","http://www2.yahoo.com:80/"]]`.
- **Exit code:** 0

- **Test command:** `rtk test docker run --rm --network host -v /tmp/verify-266-archive.mjs:/app/verify-266-archive.mjs:ro blowsh-mcp:wayback-test node /app/verify-266-archive.mjs`
- **Expected result:** archive-only Yahoo rescue after one forced availability timeout, genuine-miss `archive.stale`, archive-auto rescue, and original-error rethrow all pass in Docker.
- **Actual result:** all four assertions passed. Diagnostic retries fixed only the test harness: module resolution required mounting under `/app`, and the genuine-miss URL needed a resolvable public host.
- **Exit code:** 0

- **Final fresh gate:** repeated `rtk test npm run build`, all 11 `rtk test npx tsx tests/*.ts` suites, `rtk test docker build -t blowsh-mcp:wayback-test .`, and the Docker live script after the final SSRF-boundary edit. All exited 0.
- **Closure build gate:** `rtk test npm run build` exited 0 immediately before closure.
- **Task lint:** `lint_task_file` passed for `tasks/in-progress/266-wayback-archive-rescue.md`.
- **Markdown lint:** changed task, data-model, architecture, tool README, and tool decisions passed. `CHANGELOG.md` reports 23 pre-existing heading-spacing issues outside the changed `Unreleased` hunk; this repository configures no Markdown linter, and `git diff --check` passed.

> Verification runner rule: every suite and build above starts with `rtk test`. Raw output was retrieved only after failed RTK runs for diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded

## Risk & Rollback

- **Risk:** adding an outbound call to CDX adds latency to every rescue attempt. Mitigated by keeping the availability API as a fast path and only consulting CDX when it fails.
- **Risk:** CDX can return many rows for a URL; an unfiltered query could pick an error snapshot. Mitigated by `filter=statuscode:200` and `limit=1`.
- **Risk:** treating `api-error` as retryable could slow a genuinely dead URL. Mitigated by a single retry, then falling through to the original error.
- **Rollback plan:** the change is contained in `fetchWaybackOutcome` plus `classifyWaybackAvailability`. Restoring the previous function bodies returns the old behaviour; the new tests would then fail, which is the intended signal.

## Decision Log

**[2026-11-13] [D1] [EXECUTOR-DETECTED]:** CDX becomes the primary lookup; the availability API is demoted to a fast path.

- **Rationale:** CDX returned a real timestamp for the exact URL the availability API timed out on, and it supports `filter=statuscode:200`, so it can pick a snapshot that actually renders. Keeping availability first preserves the fast path for the common case.
- **Alternatives considered:** (a) raise the axios timeout on the availability call — rejected, the timeout is server-side (5.0 s) and not ours to raise. (b) replace availability entirely — rejected, it is one request versus CDX's heavier query for the common case.
- **Impact:** rescue works for popular URLs; a small extra latency only when the fast path fails.

**[2026-11-13] [D2] [EXECUTOR-DETECTED]:** Distinguish "API failed" from "no snapshot" in the outcome type rather than collapsing both.

- **Rationale:** the two demand different handling — a failure is worth a retry, an absence is not. Collapsing them is what made a transient timeout look like a permanent miss.
- **Alternatives considered:** retrying inside the classifier — rejected, it is pure and must stay testable.
- **Impact:** the existing `WaybackOutcomeKind` union already has `api-error`; this makes the code actually use it.

**[2026-11-26] [D3] [EXECUTION-DETECTED]:** The approved plan resolves the task's ambiguous "CDX primary" wording as availability fast path plus CDX fallback.

- **Rationale:** the Manager approved the Brain plan that explicitly keeps availability first for the common case and uses CDX after one `api-error` retry. This preserves latency while fixing the timeout regression.
- **Alternatives considered:** CDX-first for every rescue, which adds a heavier query to the common path and contradicts the approved plan.
- **Impact:** task wording now matches the implemented and approved contract.

---

## Execution Log & Reasoning

- Mode lock: AUTOMATIC (autopilot) for both backlog tasks, requested by the Manager.
- Input normalization: `sesssion` corrected to `session`.
- Assumption A1: execute the Wayback rescue first, then the WebRTC hardening, because the Manager named both without specifying order.
- Discovery recovery: both delegated scans returned idle without reports, so the executor verified the context map directly.
- Brain plan verdict: `REPORT` containing an integrated plan for both backlog fixes.
- Brainstorm: not required — both fixes are reversible bug fixes with no schema change or irreversible deployment.
- Plan artifact: `tasks/.sessions/ses_deafc52f0ffeni6fm59dFdc7pP_7dda7a6b/brain_outputs/resp_6b0774ad3427f9b90225449d_6071671f5a304abc9fc1e50a98338e0d.json`.
- Approval status: Manager selected `Approve plan` for the integrated plan.
- Claim status: moved to `tasks/in-progress/` by `claim_next`.
- Header repair: `claim_next` moved the file but left a stale `**File:**` path, so the executor corrected the header and re-ran lint.
- Implementation: added error-first availability classification, pure CDX parsing, SSRF-guarded CDX lookup, one retry, snapshot download reuse, and empty-extraction rescue eligibility.
- Verification: focused suite passes 31 checks, strict tsc passes, all 11 offline suites pass, Docker image builds, CDX returns Yahoo's archived timestamp, and all four Docker live archive assertions pass.
- Documentation: updated `docs/data_model.md`, `docs/architecture.md`, `src/tools/README.md`, `src/tools/DECISIONS.md`, and `CHANGELOG.md`.
- `DESIGN.md` unchanged: no error text change.
- Stack gate skip record: repo root `/home/mohammad/blowsh-mcp`; marker scan `package.json, tsconfig.json, src/ports/`; matched stack skills none; reason `no stack-specific blueprint matches this Node MCP server, so strict tsc is the gatekeeper`.
- Task-number discipline: the task number is omitted from living docs and retained only in this task file and `CHANGELOG.md`.
- QA verdict: `QA_PASSED`. No blocking findings. Non-blocking risks were error precedence over a concurrent hit and one extra CDX request after a second availability miss.
- QA artifact: `tasks/.sessions/ses_deafc52f0ffeni6fm59dFdc7pP_7dda7a6b/brain_outputs/resp_6b0778bf0f0292c3f2114488_4c9d15448b754c779b8f1c2f23957757.json`.
- Code Reviewer verdict: `PO_REVIEW_PENDING`. Technical review passed with no blocking defects. Final closure still requires explicit Manager approval.
- Reviewer artifact: `tasks/.sessions/ses_deafc52f0ffeni6fm59dFdc7pP_7dda7a6b/brain_outputs/resp_6b0778f951fe09ee9c1f415a_85dfb1d1682446cc979b8da72ca12a81.json`.
- Manager closure approval (verbatim answer value): `Approved for closure`.
- Next action: request the single Senior Programmer closure XML and execute it once.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `3e772ef31ffe51c410959860f728e0cd92f38eda`
<!-- END_GIT_DIFF -->