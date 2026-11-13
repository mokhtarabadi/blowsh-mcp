# Task 265: Browsh abort-notice body bypasses the empty-extraction guard

**File:** `tasks/qa/265-browsh-abort-notice-guard.md`
**Source:** manager
**Type:** bugfix
**Status:** open
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
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 4303567..c99bfda 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -10,6 +10,7 @@
 
 ### Fixed
 
+- Browsh's render-abort body was served as page content. When Browsh cannot render a page it answers HTTP **200** with a short apology as the whole body (`Browsh rendering aborted after 30s timeout.`), and that string is ordinary prose, so the empty-extraction guard accepted it — `fetch_web` on an unrenderable URL returned the apology instead of an error. `isRenderAbortNotice()` (`src/extract.ts`) now rejects it for every output type: the body must start with the notice's subject and be short, so a real page that merely discusses render failures is never matched. The `30s` figure is Browsh's own constant and is deliberately not matched, so the check survives a Browsh version change. Fails with the existing `empty.extraction` code. Regression coverage in `tests/empty-extraction-guard-tests.ts`.
 - Parallel multi-step `search_web` calls failed or timed out: every render goes through one serialized browser slot, so a 3-query `query_variants` search could queue up to 18 renders, and the per-render timeout started only *after* the slot was granted — leaving the queue wait unbounded and invisible to the caller. The wait is now bounded by `BROWSH_QUEUE_TIMEOUT_MS` (default 600000 ms) and by the request's `AbortSignal`, so a queued render fails with an honest `FetchError` instead of hanging. A waiter that gives up is skipped by `release()`, so the slot is never handed to a settled promise. The queue lives in the exported `RenderQueue` class, covered by `tests/search-timeout-hardening-tests.ts` (42 checks, no browser, no network).
 - `search_web` had no outer deadline unless the caller passed `deadline_ms`, so the client gave up while the server was still rendering. Every search now runs under a budget — `deadline_ms` when given, otherwise `SEARCH_DEADLINE_MS` (default 900000 ms) — and on expiry the in-flight renders are aborted, so a timed-out search releases the browser slot instead of rendering on in the background. The `deadline_ms` ceiling rose 600000 → 1800000 ms in the schemas, the tool descriptions, `fetch_web`, and `docs/data_model.md`, so the runtime clamp no longer silently rejected a schema-valid value.
 - The four timeout budgets contradicted each other and are now one coherent ladder: `SEARCH_DEADLINE_MS` (900000) ≥ `BROWSH_QUEUE_TIMEOUT_MS` (600000) + `BROWSH_REQUEST_TIMEOUT_MS` (180000), and the queue funds two renders. Previously the 180 s search budget was shorter than the 240 s queue wait it contained, so the budget expired before the queue bound could ever matter. The invariant is asserted in `tests/search-timeout-hardening-tests.ts` rather than as four magic numbers, so raising one knob alone fails there with the arithmetic printed.
diff --git a/DESIGN.md b/DESIGN.md
index b5d37aa..9aa7904 100644
--- a/DESIGN.md
+++ b/DESIGN.md
@@ -40,7 +40,7 @@
   - `FetchError: Request failed with status <status>`
   - `FetchError: Browsh did not start in HTTP mode within timeout`
   - `FetchError: archive.stale: no Wayback snapshot for <url> [archive=only]`
-  - `FetchError: empty extraction for <url> via <source> [dom N chars, text M chars]` — code `empty.extraction`; a render produced no usable text (whitespace-only, or markup with no readable text for text types). `type: "html"` is exempt: its payload is markup, so a shell with no visible text still returns its DOM.
+  - `FetchError: empty extraction for <url> via <source> [dom N chars, text M chars]` — code `empty.extraction`; a render produced no usable text (whitespace-only, or markup with no readable text for text types). `type: "html"` is exempt: its payload is markup, so a shell with no visible text still returns its DOM. **Also thrown when the body is Browsh's own render-abort notice** — Browsh answers HTTP 200 with `Browsh rendering aborted after N s timeout.` when it cannot render a page, and that apology is readable prose, so it is rejected rather than served as the page.
   - `FetchError: deadline.hit: search timed out after <ms>ms (query: ...)`
   - `FetchError: deadline.hit: fetch timed out after <ms>ms for <url>`
   - `FetchError: resume token expired or unknown: <token>`
diff --git a/src/extract.ts b/src/extract.ts
index fe8c501..6bbd712 100644
--- a/src/extract.ts
+++ b/src/extract.ts
@@ -121,6 +121,47 @@ export function hasReadableText(html: string): boolean {
   return text.replace(/\s+/g, " ").trim().length > 0;
 }
 
+/**
+ * Detects Browsh's "render gave up" body.
+ *
+ * When Browsh cannot render a page it does NOT fail the request: it answers
+ * HTTP 200 with a short apology as the whole body, e.g.
+ * `"Browsh rendering aborted after 30s timeout."`. That string is ordinary
+ * prose, so a readability check alone accepts it and the caller receives an
+ * apology in place of the page.
+ *
+ * Matching is deliberately keyed on the stable semantic core ("rendering
+ * aborted") rather than the literal sentence or the timeout figure: the `30s`
+ * is Browsh's own internal constant, and coupling to it would let the check
+ * fail silently the moment Browsh changes the number. A real page that merely
+ * discusses a rendering timeout keeps the word "timeout" but never claims to
+ * have aborted its own rendering, so it is not matched.
+ *
+ * Pure and side-effect free so tests can classify a body without a renderer.
+ */
+export function isRenderAbortNotice(content: string): boolean {
+  if (!content) return false;
+  // Strip any markup first so the check is the same for `html` and text types:
+  // the abort body is plain text, but a caller may hand us a wrapped version.
+  const plain = content.replace(/<[^>]*>/g, " ");
+  const normalized = plain.replace(/\s+/g, " ").trim().toLowerCase();
+  if (normalized.length === 0) return false;
+  // The notice IS the whole body — a single short sentence. Two conditions
+  // together make the match safe:
+  //   1. it must start with the notice's subject ("browsh"), so a page that
+  //      merely quotes the phrase in a paragraph or heading never matches;
+  //   2. it must be short, so a real page is never mistaken for the notice.
+  // Both are required: length alone would reject legitimately short pages, and
+  // the phrase alone would fire on any article discussing render failures.
+  if (normalized.length > 200) return false;
+  if (!normalized.startsWith("browsh")) return false;
+  return (
+    normalized.includes("browsh rendering aborted") ||
+    normalized.includes("browsh failed rendering") ||
+    normalized.includes("browsh error rendering")
+  );
+}
+
 /** Extracts the text content of a CSS selector (first match), or null. */
 export function selectText(html: string, selector: string): string | null {
   const $ = load(html);
diff --git a/src/tools/README.md b/src/tools/README.md
index 2399bc9..dfa1271 100644
--- a/src/tools/README.md
+++ b/src/tools/README.md
@@ -18,6 +18,7 @@ Batch supports only the documented subset — single-fetch options stay single-f
 A render that produces no usable text is an error, never a success body.
 
 - **Guard:** `guardEmptyExtraction(content, { url, type, domChars, source })` in `fetchWeb.ts` throws `FetchError` with code `empty.extraction` and the message `empty extraction for <url> via <source> [dom N chars, text M chars]`. `hasUsableExtraction()` holds the per-type rule.
+- **Render-abort body:** Browsh answers HTTP 200 with a short apology (`Browsh rendering aborted after 30s timeout.`) when it cannot render a page, so a failed render arrives looking like a successful one. `isRenderAbortNotice()` in `extract.ts` catches it for every type — the body must start with the notice's subject and be short, so a real page that merely discusses render failures is never matched. The `30s` figure is Browsh's own constant and is deliberately not matched.
 - **Single exit:** `render()` guards the result of `renderOnce()`, so every renderer branch (Browsh plain/DOM, HTTP-only, non-HTML direct, enhanced `processDomForType`) is covered. The stitch, archive-snapshot, and pdf paths bypass `render()` and call the same guard themselves.
 - **Type rule:** `markdown`/`plain`/`pdf` fail on whitespace-only output or output with no readable text (`hasReadableText()`); `type: "html"` fails only on a blank DOM, because its payload is markup.
 - **Fallback:** markdown conversion retries once from the full DOM (`convertMarkdownWithRetry`) when the readability pass narrowed to an empty shell while the DOM still held text, and only then fails.
diff --git a/src/tools/fetchWeb.ts b/src/tools/fetchWeb.ts
index 7ccdd29..fc1dbd7 100644
--- a/src/tools/fetchWeb.ts
+++ b/src/tools/fetchWeb.ts
@@ -18,6 +18,7 @@ import {
   stripMedia,
   applyOffset,
   hasReadableText,
+  isRenderAbortNotice,
 } from "../extract.js";
 import { FetchError, createDeadlineError } from "../errors.js";
 import {
@@ -115,11 +116,18 @@ export interface EmptyExtractionContext {
  *   content worth serving (callers inspect the shell). Only a blank DOM fails.
  * - every text type (plain/markdown/pdf): whitespace-only output fails, and so
  *   does output with no readable text after markup stripping.
+ * - every type: Browsh's own render-abort notice fails. Browsh answers HTTP 200
+ *   with that apology as the whole body when it cannot render a page, and the
+ *   string is readable prose, so without this check a failed render is served
+ *   as the page. See `isRenderAbortNotice`.
  *
  * Pure, so the contract is testable without Browsh or html2markdown.
  */
 export function hasUsableExtraction(content: string, type: string): boolean {
   if (content.trim().length === 0) return false;
+  // Applies to every type: an abort notice is a failed render regardless of
+  // the shape the caller asked for, and serving it as `html` is just as wrong.
+  if (isRenderAbortNotice(content)) return false;
   if (type === "html") return true;
   return hasReadableText(content);
 }
diff --git a/tests/empty-extraction-guard-tests.ts b/tests/empty-extraction-guard-tests.ts
index 0bd6a3d..f9d7826 100644
--- a/tests/empty-extraction-guard-tests.ts
+++ b/tests/empty-extraction-guard-tests.ts
@@ -18,8 +18,8 @@
  *  - a healthy ~17 KB markdown body passes untouched
  */
 
-import { hasReadableText } from "../src/extract.js";
-import { guardEmptyExtraction } from "../src/tools/fetchWeb.js";
+import { hasReadableText, isRenderAbortNotice } from "../src/extract.js";
+import { guardEmptyExtraction, hasUsableExtraction } from "../src/tools/fetchWeb.js";
 import { FetchError } from "../src/errors.js";
 
 // ── Harness (mirrors tests/qa-boundary-tests.ts) ───────────────────────────
@@ -70,6 +70,41 @@ check(
   hasReadableText("<main><h1>Moderation</h1><p>The moderations endpoint classifies text.</p></main>") === true
 );
 
+// ── isRenderAbortNotice (Browsh abort body) ────────────────────────────────
+
+console.log("=== isRenderAbortNotice ===");
+
+// The exact body observed from Browsh at the HTTP boundary.
+const ABORT_BODY = "Browsh rendering aborted after 30s timeout. ";
+
+check("observed abort body is detected", isRenderAbortNotice(ABORT_BODY) === true);
+check("abort body without the volatile number is still detected", isRenderAbortNotice("Browsh rendering aborted after 90s timeout.") === true);
+check("a variant wording is detected", isRenderAbortNotice("Browsh rendering aborted.") === true);
+check("empty string is not an abort notice", isRenderAbortNotice("") === false);
+check("whitespace is not an abort notice", isRenderAbortNotice("   \n\t ") === false);
+
+// The over-broad-match guard: a real page that merely discusses timeouts.
+check(
+  "a page discussing render timeouts is NOT an abort notice",
+  isRenderAbortNotice(
+    "<html><body><h1>Debugging timeouts</h1><p>When a headless browser is slow, the render aborted path is worth understanding. Here is how rendering aborted after 30s timeout appears in logs.</p></body></html>"
+  ) === false,
+  "a long page must not be classified as an abort notice"
+);
+
+// ── hasUsableExtraction: abort body fails for every type ───────────────────
+
+console.log("=== hasUsableExtraction (abort body) ===");
+
+for (const type of ["plain", "markdown", "pdf"]) {
+  check(`abort body is not usable for type=${type}`, hasUsableExtraction(ABORT_BODY, type) === false);
+}
+check("abort body is not usable for type=html", hasUsableExtraction(ABORT_BODY, "html") === false);
+check(
+  "a normal body is still usable for type=markdown",
+  hasUsableExtraction("<main><h1>Docs</h1><p>Real content here.</p></main>", "markdown") === true
+);
+
 // ── guardEmptyExtraction: text types ───────────────────────────────────────
 
 console.log("=== guardEmptyExtraction (markdown / plain) ===");
```
<!-- END_GIT_DIFF -->