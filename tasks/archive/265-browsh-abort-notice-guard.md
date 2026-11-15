# Task 265: Browsh abort-notice body bypasses the empty-extraction guard

**File:** `tasks/completed/265-browsh-abort-notice-guard.md`
**Source:** manager
**Type:** bugfix
**Status:** closed
**Finished:** 2026-11-13T19:10:16Z
**Submitted:** 2026-11-13T19:09:27Z
**Started:** 2026-11-13T19:09:08Z

## Source Context

### Variant C: Manager (`**Source:** manager`)

## Goal

Close the hole in the empty-extraction guard: when Browsh cannot render a page it answers HTTP 200 with a short apology string instead of an error, and that string currently passes `hasUsableExtraction` as if it were real content. Treat Browsh's own abort notice as a failed render, so the caller gets an honest `FetchError` (`empty.extraction`) rather than an apology masquerading as the page.

## Manager's Notes

Found during live verification of the rebuilt container (task 264). The Manager asked to "create a task and fix it, then re build locally and deploy, and verify it, then if pass, close task".

### Reproduction (verified, not inferred)

At the Browsh boundary, inside the running container:

```
$ docker exec blowsh-singleton node -e "...fetch('http://127.0.0.1:4333/' + url, {headers:{'X-Browsh-Raw-Mode':'DOM'}})"
https://httpbin.org/status/404 -> status 200 | body chars 43 | head: "Browsh rendering aborted after 30s timeout."
https://example.com            -> status 200 | body chars 2075 | head: "<html><head>..."
```

Through the MCP tool:

| URL | Result |
| --- | --- |
| `https://httpbin.org/status/404` | returned as **content** (wrong) |
| `https://httpbin.org/status/500` | returned as **content** (wrong) |
| `https://example.com` | renders correctly |
| `https://httpbin.org/html` | renders correctly |
| `https://en.wikipedia.org/wiki/Main_Page` | renders correctly |
| `https://www.reddit.com` | renders correctly |

Direct guard probe:

```
body: "Browsh rendering aborted after 30s timeout. "
hasReadableText: true
hasUsableExtraction(markdown): true   <-- the hole
hasUsableExtraction(plain): true      <-- the hole
```

### Root cause

`hasUsableExtraction` (`src/tools/fetchWeb.ts:121-125`) rejects only whitespace-only output, then delegates to `hasReadableText`. Browsh's abort notice is ordinary English prose, so it satisfies both checks. The string originates in the Browsh binary itself — it is not in this repo's source — so it can only be detected by matching it, not by fixing its producer.

Note the `30s` in the message is Browsh's own hardcoded value and has nothing to do with `BROWSH_REQUEST_TIMEOUT_MS` (180 s). The number in the message must therefore not be matched literally, or the check breaks the moment Browsh changes it.

### Scope boundary (agreed with the Manager)

- **In scope:** detect Browsh's abort-notice body and fail it honestly.
- **Out of scope:** propagating the real HTTP status for 404/500. Browsh answers 200 for everything, so recovering the true status would need an extra request per fetch. The Manager agreed to leave this alone.

## Local TODOs

- [x] Reproduce at the Browsh boundary and through the MCP tool
- [x] Confirm the guard probe shows the hole
- [x] Implement the abort-notice detector and wire it into `hasUsableExtraction`
- [x] Add regression checks to the existing guard suite
- [x] Verify: `npm run build` + all `tests/*.ts` suites
- [x] Rebuild the Docker image and redeploy `blowsh-singleton`
- [x] Verify live through the MCP server: the 404/500 cases now fail honestly, normal pages still work
- [x] Record evidence, stage, QA transition

## Acceptance Criteria

- [x] A body matching Browsh's abort notice is rejected by `hasUsableExtraction` for every text type (`plain`, `markdown`, `pdf`).
- [x] The detector does not depend on the literal `30s` figure, so it survives a Browsh version change.
- [x] A genuine page whose prose happens to discuss a rendering timeout is NOT rejected (no over-broad substring match).
- [x] `fetch_web` on an unrenderable URL throws `FetchError` with code `empty.extraction` instead of returning the apology as content.
- [x] `fetch_web` on a normal page is unchanged.
- [x] `npm run build` exits 0 and all `tests/*.ts` suites exit 0.
- [x] The rebuilt image, deployed and verified live, fails the 404/500 cases honestly and still renders normal pages.

## Verification Evidence

### 1. Regression suite (RTK first run)

- **Test command:** `rtk test npx tsx tests/empty-extraction-guard-tests.ts`
- **Expected result:** existing checks still pass, plus the new abort-notice checks.
- **Actual result:** `Overall: ALL PASS`. New group `isRenderAbortNotice` (6 checks) and `hasUsableExtraction (abort body)` (5 checks) all pass, including the over-broad-match guard.
- **Exit code:** 0

Raw rerun, the new groups:

```
=== isRenderAbortNotice ===
observed abort body is detected: PASS
abort body without the volatile number is still detected: PASS
a variant wording is detected: PASS
empty string is not an abort notice: PASS
whitespace is not an abort notice: PASS
a page discussing render timeouts is NOT an abort notice: PASS
=== hasUsableExtraction (abort body) ===
abort body is not usable for type=plain: PASS
abort body is not usable for type=markdown: PASS
abort body is not usable for type=pdf: PASS
abort body is not usable for type=html: PASS
a normal body is still usable for type=markdown: PASS
```

### 2. Real-world guard probe

Probe against the exact observed body, asserting the error code:

```
throws FetchError/empty.extraction: true
message: empty extraction for https://httpbin.org/status/404 via browsh-markdown [dom 43 chars, text 43 chars]
```

Before the fix this same body returned `hasUsableExtraction(markdown) === true` and was served as content.

### 3. Build (RTK first run)

- **Test command:** `rtk test npm run build`
- **Expected result:** strict tsc compiles with no errors.
- **Actual result:** `> tsc` with no diagnostics.
- **Exit code:** 0

### 4. Full regression

- **Test command:** loop over `tests/*.ts` with `npx tsx`
- **Expected result:** all nine suites exit 0.
- **Actual result:** all nine exit 0.
- **Exit code:** 0

### 5. Live verification after redeploy

Image rebuilt (`docker build -t blowsh-mcp:latest .`, exit 0), confirmed the fix is compiled in (`grep -c "browsh rendering aborted" dist/extract.js` → 1), container stopped/removed/recreated with the same config and enhanced budgets.

Through the MCP server (`127.0.0.1:8107`), the exact cases that previously returned the apology as content:

| URL | Before | After |
| --- | --- | --- |
| `https://httpbin.org/status/404` | returned apology as content | `FetchError: empty extraction ... [dom 43 chars, text 43 chars]` |
| `https://httpbin.org/status/500` | returned apology as content | `FetchError: empty extraction ... [dom 43 chars, text 43 chars]` |
| `https://example.com` | rendered | renders (unchanged) |

Regression, same session:

| Check | Result |
| --- | --- |
| `en.wikipedia.org/wiki/Main_Page` | renders, no abort marker |
| `httpbin.org/html` | renders, no abort marker |
| `search_web` | 2 results |
| `fetch_web_batch` (ok + 404) | `[{ok:true}, {ok:false}]` — per-item isolation holds, the 404 now surfaces as an error |

The batch is the clearest proof: the good URL still succeeds while the unrenderable one reports `ok:false` instead of quietly returning an apology.

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded
- [x] Deployed image verified live (Manager explicitly asked for deploy + verify before closure)

## Risk & Rollback

- **Risk:** an over-broad matcher could reject legitimate pages that merely mention a timeout, turning a working fetch into a false error. Mitigated by matching the specific apology sentence shape rather than the word "timeout", and by a regression check for exactly that case.
- **Risk:** Browsh could change its wording, silently disabling the check. Mitigated by matching on the stable part of the sentence (`rendering aborted`) rather than the volatile number, and by a comment recording why.
- **Rollback plan:** the change is one exported predicate plus one line in `hasUsableExtraction`. Removing both restores the previous behaviour exactly; the new tests would then fail, which is the intended signal.

## Decision Log

**[2026-11-13] [D1] [EXECUTOR-DETECTED]:** Match the apology's stable shape, not its number.

- **Rationale:** the `30s` in the message is Browsh's internal constant, not ours. Matching it literally would couple our guard to a number Browsh can change in any release, and the check would fail silently — the exact failure mode this task exists to remove.
- **Alternatives considered:** (a) match the full literal string including `30s` — rejected, brittle. (b) treat any body under some char threshold as a failure — rejected, it would break legitimately short pages.
- **Impact:** the detector keys on "rendering aborted", which is the semantic core of the notice.

**[2026-11-13] [D2] [EXECUTOR-DETECTED]:** Reuse the existing `empty.extraction` error code rather than inventing a new one.

- **Rationale:** the failure is the same class the guard already covers — a render that produced no usable content. A new code would force every consumer to learn a second name for the same condition.
- **Alternatives considered:** a new `render.abort` code — rejected, it fragments the contract.
- **Impact:** callers that already handle `empty.extraction` handle this automatically.

---

## Execution Log & Reasoning

### What changed and why

**`src/extract.ts` — new `isRenderAbortNotice(content)` predicate.**
Browsh cannot signal a render failure through its HTTP API: it answers 200 for everything, including its own failure notice. That notice is prose, so the readability check accepted it. The predicate requires two conditions together — the body must *start* with the notice's subject and be short (under 200 chars). Both are needed: length alone would reject legitimately short pages, and the phrase alone would fire on any article discussing render failures.

The `30s` in the message is Browsh's internal constant, not ours, so it is deliberately not matched. A regression check asserts a `90s` variant is still caught, which proves the detector keys on the stable part.

**`src/tools/fetchWeb.ts` — wired into `hasUsableExtraction`.**
One line, placed before the per-type branch so it applies to every output type. An abort notice served as `html` is just as wrong as one served as `markdown`. Reuses the existing `empty.extraction` code rather than inventing a second name for the same condition.

### Defects found during implementation (both mine, both caught by the new tests)

1. **The over-broad-match guard failed on the first run.** I wrote the test expecting a long page that quotes the phrase to be rejected, but my length ceiling was 400 chars and the test page was ~230 — so the phrase check fired. Fixed by making the check semantic (must start with "browsh") rather than relying on length alone.
2. **Missing import.** `hasUsableExtraction` was used in the test before being imported; the suite crashed with a `ReferenceError`. Fixed.

Both are the reason the tests exist: each would have shipped as a silently wrong guard.

### Out of scope, deliberately

Recovering the real HTTP status for 404/500. Browsh answers 200 for everything, so detecting the true status would need an extra request per fetch. The Manager agreed to leave this alone; the abort-notice fix is what makes the failure honest.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `0950ae9d83dac87cc441b5b51e3579733741029f`
<!-- END_GIT_DIFF -->