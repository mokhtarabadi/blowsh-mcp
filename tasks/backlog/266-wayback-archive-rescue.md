# Task 266: Wayback archive rescue silently fails when the availability API times out

**File:** `tasks/backlog/266-wayback-archive-rescue.md`
**Source:** manager
**Type:** bug
**Status:** open

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

- [ ] Fix `classifyWaybackAvailability` to read the `error` field and return `"api-error"` instead of `"no-snapshot"` on a transient failure
- [ ] Add the CDX endpoint as the primary lookup, keeping availability as a fallback
- [ ] Make the rescue retry once on a transient API failure before giving up
- [ ] Verify `isHardFailure` triggers the rescue for an abort-notice/empty-extraction failure (message-based path)
- [ ] Add regression tests for: timeout payload → `api-error`, empty snapshots → `no-snapshot`, real CDX hit → `hit`, snapshot body too small → `snapshot-fetch-failed`
- [ ] Verify live: `archive: "only"` and `archive: "auto"` rescue a dead URL
- [ ] Update `docs/data_model.md`, `DESIGN.md`, `CHANGELOG.md`, and `src/tools/DECISIONS.md`

## Acceptance Criteria

- [ ] `classifyWaybackAvailability` returns `api-error` (not `no-snapshot`) when the payload carries an `error` object or the snapshot list is empty with an error.
- [ ] The rescue uses CDX as its primary lookup and resolves a real timestamp for a URL the availability API times out on (regression case: `https://www.yahoo.com`).
- [ ] A transient API failure is retried once before the rescue gives up.
- [ ] `archive: "only"` on a genuinely archived URL returns the archived content with the `> [archive snapshot from ...]` banner.
- [ ] `archive: "only"` on a URL with no snapshot anywhere still throws `archive.stale` (unchanged contract).
- [ ] `archive: "auto"` rescues a failed live fetch when a snapshot exists, and rethrows the original error when none does.
- [ ] No existing test regresses: `npm run build` exits 0 and all `tests/*.ts` suites exit 0.

## Verification Evidence

- **Test command:** `rtk test npx tsx tests/task10-stress-fixes.ts`
- **Expected result:** the existing Wayback classifier and hard-failure checks still pass.
- **Actual result:** _(The Hands fill this during execution)_
- **Exit code:** _(The Hands fill this during execution)_

- **Test command:** `rtk test npm run build`
- **Expected result:** strict tsc compiles with no errors.
- **Actual result:** _(The Hands fill this during execution)_
- **Exit code:** _(The Hands fill this during execution)_

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [ ] Build/Test/Lint pass with exit code 0
- [ ] `lint_task_file` passes on the active task file
- [ ] `CHANGELOG.md` updated via Parse-Then-Append
- [ ] `testing-verification` applied and evidence recorded

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

---

## Execution Log & Reasoning

_(The Hands: Manually log your technical changes, file edits, and architectural reasoning here BEFORE calling the MCP tool)_

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index c99bfda..8fd8cae 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -10,6 +10,7 @@
 
 ### Fixed
 
+- Wayback archive rescue is diagnosed but **not yet fixed** — tracked as a backlog task. The availability API returns a transient timeout payload (`{archived_snapshots:{}, error:{code:"timeout"}}`) for popular URLs, and `classifyWaybackAvailability` reads that as "no snapshot", so `archive: "auto"` / `"only"` report a miss for URLs that are demonstrably archived. Verified: `https://www.yahoo.com` fails while `example.com` and `wikipedia.org` succeed; the CDX API returns a real timestamp for `yahoo.com`.
 - Browsh's render-abort body was served as page content. When Browsh cannot render a page it answers HTTP **200** with a short apology as the whole body (`Browsh rendering aborted after 30s timeout.`), and that string is ordinary prose, so the empty-extraction guard accepted it — `fetch_web` on an unrenderable URL returned the apology instead of an error. `isRenderAbortNotice()` (`src/extract.ts`) now rejects it for every output type: the body must start with the notice's subject and be short, so a real page that merely discusses render failures is never matched. The `30s` figure is Browsh's own constant and is deliberately not matched, so the check survives a Browsh version change. Fails with the existing `empty.extraction` code. Regression coverage in `tests/empty-extraction-guard-tests.ts`.
 - Parallel multi-step `search_web` calls failed or timed out: every render goes through one serialized browser slot, so a 3-query `query_variants` search could queue up to 18 renders, and the per-render timeout started only *after* the slot was granted — leaving the queue wait unbounded and invisible to the caller. The wait is now bounded by `BROWSH_QUEUE_TIMEOUT_MS` (default 600000 ms) and by the request's `AbortSignal`, so a queued render fails with an honest `FetchError` instead of hanging. A waiter that gives up is skipped by `release()`, so the slot is never handed to a settled promise. The queue lives in the exported `RenderQueue` class, covered by `tests/search-timeout-hardening-tests.ts` (42 checks, no browser, no network).
 - `search_web` had no outer deadline unless the caller passed `deadline_ms`, so the client gave up while the server was still rendering. Every search now runs under a budget — `deadline_ms` when given, otherwise `SEARCH_DEADLINE_MS` (default 900000 ms) — and on expiry the in-flight renders are aborted, so a timed-out search releases the browser slot instead of rendering on in the background. The `deadline_ms` ceiling rose 600000 → 1800000 ms in the schemas, the tool descriptions, `fetch_web`, and `docs/data_model.md`, so the runtime clamp no longer silently rejected a schema-valid value.
```
<!-- END_GIT_DIFF -->