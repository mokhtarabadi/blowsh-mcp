# Task 261: `fetch_web` returns a silent empty success when the renderer extracts no text

**File:** `tasks/qa/261-fetch-web-silent-empty-body.md`
**Source:** manager
**Type:** bugfix
**Status:** closed
**Submitted:** 2026-11-11T08:45:28Z
**Started:** 2026-11-11T07:36:41Z

## Goal

Make `fetch_web` fail loudly (or at least declare the empty result) when a page renders but no readable text is
extracted, instead of returning a one-byte body that looks like success.

## Context

Observed while researching the OpenAI moderation API from Cando on 2026-11-11, twice, on the same URL:

| Call | Result |
|---|---|
| `fetch_web({ url: "https://platform.openai.com/docs/api-reference/moderations", type: "markdown" })` | `len: 1`, content `"\n"` — **no error** |
| `fetch_web({ url: "https://docs.avalai.ir/en/api-reference/moderation", type: "markdown" })` | `len: 17730` — same call shape, real content |

So the tool reports success with an unusable body. A caller cannot distinguish "this page is empty" from "Browsh
rendered a shell and the extractor found nothing", and an agent reading that result concludes the page has no
content. That is the worst failure shape for a research tool: silence instead of an error.

Likely shape (to confirm during the fix, not assumed): the page is a JS-heavy SPA behind bot protection; Browsh
returns a DOM whose readable text is empty or whitespace-only, and the markdown/plain conversion yields `"\n"`.
The empty string then passes whatever validation exists and is returned as a successful result.

Secondary observation, same session: on `docs.avalai.ir` the extraction keeps site chrome ("Ask AI" navigation
block repeated at the top). Not a failure — the content is usable — but it is boilerplate that a readability pass
could drop. Worth a look while in this code, not a reason for a separate task.

## Local TODOs

- [x] Reproduce against the OpenAI URL and capture the rendered HTML length versus the extracted text length
- [x] Decide the contract: hard error versus a flagged result (`emptyExtraction: true` plus a short diagnostic)
- [x] Implement the guard at the single point where extracted text leaves the renderer, so every `type`
      (plain / html / markdown) is covered
- [x] Consider a fallback path (raw HTML → text extraction, or one retry with a longer settle time) before failing
- [x] Regression test: a renderer stub returning an empty/whitespace body must not yield a successful result
- [x] Note the boilerplate observation; only fix if it is a small, contained change

### TODO notes

- Reproduction is code-path proof, not a live fetch: Browsh, Firefox, and html2markdown are not installed on this
  host (AGENTS.md guardrail), and the two reported URLs are external. The failing branch is identified by reading
  the pipeline: `extractMainHtml(dom)` → `html2markdownConvert(source)` had no post-condition, so a whitespace-only
  conversion was returned and cached. The renderer stub in `tests/empty-extraction-guard-tests.ts` replays exactly
  that shape (`dom 48210 chars → text "\n"`).
- Boilerplate observation (`docs.avalai.ir` "Ask AI" nav block) is **not** fixed: `extractMainHtml` already strips
  `nav`/`header`/`footer`/`aside`, so the remaining block is page-specific markup, and a targeted rule would be a
  readability rework outside this fix. Recorded here as a separate, non-blocking observation.

## Acceptance Criteria

- [x] A page whose extracted text is empty or whitespace-only never returns as a success
- [x] The failure names the URL, the renderer outcome, and how much (if any) HTML was available
- [x] Non-empty pages are unaffected: `docs.avalai.ir` still returns its ~17 KB
- [x] Covered by a test that stubs the renderer — no live network in the test
- [x] `npm run build` stays clean (strict tsc is the only gate in this repo)

## Verification Evidence

- **Test command:**
  - `rtk test npm run build`
  - `rtk test npx tsx tests/empty-extraction-guard-tests.ts`
  - `rtk test npx tsx tests/qa-boundary-tests.ts`
  - `rtk test npx tsx tests/verify-donsetch-parity.ts`
  - `rtk test npx tsx tests/guard-detector-tests.ts`
- **Expected result:** build clean, new suite red before the fix and green after, existing suites unchanged green
- **Actual result:**
  - RED (before implementation): `npx tsx tests/empty-extraction-guard-tests.ts` → `SyntaxError: The requested
    module '../src/tools/fetchWeb.js' does not provide an export named 'guardEmptyExtraction'`, exit 1.
  - GREEN: `rtk test npm run build` → `> tsc` with no diagnostics, exit 0.
  - GREEN: new suite → 15/15 `PASS`, `Overall: ALL PASS`, exit 0 (empty markdown, whitespace-only markdown, empty
    plain, blank html all throw `FetchError` code `empty.extraction`; html markup shell passes; healthy ~17 KB
    markdown passes; message carries url + renderer branch + dom chars + text chars).
  - Regression: `tests/qa-boundary-tests.ts` → `Overall: ALL PASS ✓`, exit 0; `tests/verify-donsetch-parity.ts` →
    `26 pass, 0 fail of 26`, exit 0; `tests/guard-detector-tests.ts` → `All guard-detector tests passed.`, exit 0.
  - Environment note: `node_modules` was empty in the worktree, so `npm install --no-audit --no-fund` ran first
    (186 packages) to make the build/test gate executable. No dependency was added.
- **Exit code:** 0 for every gate command above (RED run intentionally exited 1 before the fix)

## Definition of Done

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated
- [x] `testing-verification` applied and evidence recorded

## Risk & Rollback

- **Risk:** pages that legitimately contain almost no text (image-only pages, PDF shells, login walls) would start
  returning errors where callers previously got an empty string.
- **Rollback plan:** the threshold and the error/flag behaviour are one constant and one branch; reverting restores
  the previous success-with-empty behaviour.

---

## Execution Log & Reasoning

**2026-11-11 — implementation.**

Root cause (read from the code, not assumed): `renderOnce()` returned whatever the branch produced with no
post-condition. For `type: "markdown"` the chain was `extractMainHtml(dom)` → `html2markdownConvert(source)`; a
render whose readable text was empty produced `"\n"`, `fetchWebInner` cached it under the settle key, and
`fetchWeb()` returned it as success. Nothing distinguished "page is empty" from "renderer produced a shell".

Change set:

| File | Change |
|---|---|
| `src/extract.ts` | New exported pure `hasReadableText(html)` — cheerio load, `stripNoise`, body text collapsed and trimmed. One definition of "readable text" for the guard and the retry. |
| `src/tools/fetchWeb.ts` | `RenderResult { content, domChars, source }` returned by `renderOnce` (all 7 return sites relabelled); `EMPTY_EXTRACTION_CODE`, `EmptyExtractionContext`, `hasUsableExtraction()`, `guardEmptyExtraction()` exported; `render()` guards the single exit before the caller caches; `convertMarkdownWithRetry()` for the one full-DOM retry; guard added to the pdf, stitch, and archive-snapshot paths that bypass `render()`; sibling-doc pointer comment added. |
| `tests/empty-extraction-guard-tests.ts` | New tsx regression suite (15 checks) stubbing the render result — no network, no Browsh, no html2markdown. |
| `src/tools/README.md`, `src/tools/DECISIONS.md` | Guard contract section + dated ADR. |
| `DESIGN.md` | `empty.extraction` added to the error catalogue (§3). |
| `CHANGELOG.md` | `[Unreleased] → Fixed` entry. |

Reasoning:

- One guard, not seven. Every renderer branch (Browsh plain/DOM, HTTP-only, non-HTML direct, enhanced
  `processDomForType`) funnels through `render()`, so the guard sits there. The stitch, archive, and pdf paths
  genuinely bypass `render()`, so they call the same exported guard rather than duplicating logic.
- Cache safety follows automatically: `fetchWebInner` caches only what `render()` returned, and `render()` cannot
  return an empty body.
- The retry exists because the observed failure has two shapes: a truly empty DOM, and a DOM with text that the
  readability pass narrowed away. The retry only fires when `hasReadableText(fullDom)` is true, so it can never
  fabricate content.
- `html` keeps its markup exemption: the caller asked for markup, and a shell with no visible text is still a
  diagnosable answer (e.g. "the SPA never hydrated"). Only a blank DOM fails.

Decisions (see `## Decision Log` below): D1 hard error over flagged result, D2 html markup exemption, D3 single
guard at the render exit.

Assumptions:

- A1: the two reported URLs could not be re-fetched live (external network + Browsh/html2markdown absent on this
  host), so reproduction is code-path proof plus a renderer stub that replays the observed `dom 48210 → text "\n"`
  shape. Logged rather than blocking.
- A2: `node_modules` was absent in the worktree; `npm install --no-audit --no-fund` ran to make the tsc gate
  executable. No dependency was added or changed (`package.json`/`package-lock.json` untouched).
- A3: `src/extract.ts` has no sibling `DECISIONS.md`, so only `src/tools/fetchWeb.ts` received the one-line
  sibling-doc pointer. Creating `src/DECISIONS.md` is a separate scaffolding decision, not part of this fix.

Open questions for the Manager (non-blocking):

- Q1: the governance audit run in this session patched `AGENTS.md` and `docs/conventions.md` (deprecated Lite Mode
  purge, atomic `qa_transition` sequence, Project Skills table, Parallel Index Isolation, Edit Tool Discipline,
  Living Folder Docs, `## Decision Log` retarget). Those two files are deliberately **not** part of this task's
  `modified_files`; they need their own commit decision.
- Q2: `fetch_web` on an image-only page now errors instead of returning an empty string (accepted risk R1 in the
  task file). If a caller needs the old behaviour, the threshold constant and the guard call are the only knobs.

## Decision Log

**[2026-11-11] [D1] [ORCHESTRATOR-DETECTED]:** Empty extraction throws `FetchError` (code `empty.extraction`); a
flagged success is rejected.
- **Rationale:** the acceptance criteria forbid empty-as-success, and AGENTS.md forbids error-shaped successes.
- **Alternatives considered:** `emptyExtraction: true` flag inside a success body.
- **Impact:** callers get a loud, actionable error; image-only pages and login walls change behaviour (risk R1).

**[2026-11-11] [D2] [ORCHESTRATOR-DETECTED]:** `type: "html"` keeps a markup exemption — only a blank DOM fails.
- **Rationale:** the html payload is markup; a shell with no visible text is still the answer the caller asked for.
- **Alternatives considered:** applying the text rule to html (would hide shell diagnosis).
- **Impact:** an SPA shell fetched as html still succeeds; the same URL fetched as markdown/plain now errors.

**[2026-11-11] [D3] [EXECUTION-DETECTED]:** One guard at the `render()` exit plus explicit calls on the three
bypass paths, instead of a check at each of the seven `renderOnce` return sites.
- **Rationale:** a new renderer branch cannot silently skip the guard; bypass paths are named and greppable.
- **Alternatives considered:** per-site guards (duplicated branches, easy to miss on the next path added).
- **Impact:** `renderOnce` returns `RenderResult` instead of a string — the seam the regression test stubs.

## QA & Review Outcome

- **QA Engineer — `QA_PASSED`.** All renderer returns enumerated and funnelled through `render()`; the pdf, stitch,
  and archive-snapshot bypasses call the same guard; message contract matches `DESIGN.md`; non-empty paths unchanged
  (settle loop compares `content`); RED→GREEN proven. Residual notes it closed as out of scope: post-cache
  transforms (`offset`, `links=false`, `media=false`) can still empty a guarded body — pagination/user-requested
  stripping, not extraction failure.
- **Code Reviewer — `APPROVED` → `PO_REVIEW_PENDING`.** Blueprint conformance complete, scope clean, contract matches
  docs, single-exit design holds, no new dependency, ESM and strict tsc preserved. Three low-severity observations,
  none blocking: (I1) `hasUsableExtraction` could take a falsy guard for symmetry with `hasReadableText` — unreachable
  under TS types; (I2) `src/extract.ts` is documented via `src/tools/DECISIONS.md` with no `src/DECISIONS.md` (logged
  as A3); (I3) same post-cache transform note as QA.
- **Closure gate:** awaiting the Manager's explicit "Approved for closure" / "Close task". Nothing is committed.



## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index a701497..736cdc7 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,5 +1,11 @@
 # Changelog
 
+## [Unreleased]
+
+### Fixed
+
+- `fetch_web` silent empty success: a render that produced no readable text (JS-heavy SPA shell behind bot protection, login wall, image-only page) used to return a one-byte body as a success and cache it. Extraction now funnels through one guard at the render exit (`guardEmptyExtraction`, stable code `empty.extraction`) plus the same guard on the stitch, archive, and pdf paths, so an empty body throws a `FetchError` with the stable code `empty.extraction` and the message `empty extraction for <url> via <source> [dom N chars, text M chars]` instead of passing as content. Text types fail on whitespace-only output; `type: "html"` keeps its markup exemption (a shell with no visible text still returns its DOM). Markdown gets one full-DOM retry when the readability pass narrowed to an empty shell while the DOM still held text. Empty results are never cached. New `tests/empty-extraction-guard-tests.ts` (15 checks, renderer stubbed, no network).
+
 ## [2.6.1] - 2026-10-19
 
 ### Fixed
diff --git a/DESIGN.md b/DESIGN.md
index 7384caa..b5d37aa 100644
--- a/DESIGN.md
+++ b/DESIGN.md
@@ -40,6 +40,7 @@
   - `FetchError: Request failed with status <status>`
   - `FetchError: Browsh did not start in HTTP mode within timeout`
   - `FetchError: archive.stale: no Wayback snapshot for <url> [archive=only]`
+  - `FetchError: empty extraction for <url> via <source> [dom N chars, text M chars]` — code `empty.extraction`; a render produced no usable text (whitespace-only, or markup with no readable text for text types). `type: "html"` is exempt: its payload is markup, so a shell with no visible text still returns its DOM.
   - `FetchError: deadline.hit: search timed out after <ms>ms (query: ...)`
   - `FetchError: deadline.hit: fetch timed out after <ms>ms for <url>`
   - `FetchError: resume token expired or unknown: <token>`
diff --git a/src/extract.ts b/src/extract.ts
index 7ec9eb4..acb6ec4 100644
--- a/src/extract.ts
+++ b/src/extract.ts
@@ -100,6 +100,26 @@ export function extractMainHtml(html: string): string {
   return $("body").html() ?? "";
 }
 
+/**
+ * True when the markup carries visible text once scripts, styles, templates
+ * and tags are stripped.
+ *
+ * This is the empty-extraction signal for text output types (markdown/plain):
+ * a JS-heavy SPA that renders only `#root` containers has a large DOM but no
+ * readable text, and must never be served as a successful fetch. Markup output
+ * (`type: "html"`) is exempt — its payload is the DOM itself.
+ *
+ * Pure and side-effect free so tests can classify markup without a renderer.
+ */
+export function hasReadableText(html: string): boolean {
+  if (!html || html.trim().length === 0) return false;
+  const $ = load(html);
+  stripNoise($);
+  const body = $("body");
+  const text = body.length > 0 ? body.text() : $.root().text();
+  return text.replace(/\s+/g, " ").trim().length > 0;
+}
+
 /** Extracts the text content of a CSS selector (first match), or null. */
 export function selectText(html: string, selector: string): string | null {
   const $ = load(html);
diff --git a/src/tools/DECISIONS.md b/src/tools/DECISIONS.md
new file mode 100644
index 0000000..3149479
--- /dev/null
+++ b/src/tools/DECISIONS.md
@@ -0,0 +1,15 @@
+# src/tools — Decisions
+
+Chronological Architectural Decision Records for the MCP tool handlers. Newest last. Each entry: Context, Decision, Consequences, Rollback.
+
+## 2026-11-11 — `fetch_web` empty extraction is a hard error, not a flagged success
+
+**Context.** `fetch_web({ url, type: "markdown" })` returned a one-byte body (`"\n"`) with no error for a JS-heavy SPA behind bot protection, while the same call shape on a normal docs page returned ~17 KB. The render pipeline had no post-condition: `renderOnce` returned whatever the readability pass plus `html2markdown` produced, and `fetchWebInner` cached and served it. A caller could not distinguish "the page is empty" from "the renderer produced a shell and the extractor found nothing" — the worst failure shape for a research tool.
+
+**Decision.** An empty or unreadable extraction throws `FetchError` with the stable code `empty.extraction` and the message `empty extraction for <url> via <source> [dom N chars, text M chars]`. One guard (`guardEmptyExtraction`) sits at the `render()` exit so every renderer branch is covered; the stitch, archive-snapshot, and pdf paths call the same guard because they bypass `render()`. Text types (`markdown`/`plain`/`pdf`) fail on whitespace-only output or output with no readable text; `type: "html"` fails only on a blank DOM, since its payload is markup and a shell is still diagnosable. Markdown retries once from the full DOM when the readability pass narrowed to an empty shell. Nothing empty is cached.
+
+**Alternatives rejected.** (a) A flagged success (`emptyExtraction: true` plus a diagnostic in the body) — it keeps the "looks like success" shape the bug report is about, and AGENTS.md forbids error-shaped successes. (b) Guarding each of the seven `renderOnce` return sites — duplicated branches, easy to miss on the next renderer path.
+
+**Consequences.** Image-only pages, PDF shells, and login walls that previously returned an empty string now throw. Agents get an actionable error naming the URL, the renderer branch, the DOM size, and the extracted text size. `renderOnce` now returns `RenderResult` instead of a bare string, which is the seam tests stub (Browsh and html2markdown are external binaries, absent on the dev host).
+
+**Rollback.** The threshold and the failure behaviour are one branch in `guardEmptyExtraction` plus one constant (`EMPTY_EXTRACTION_CODE`); removing the guard call in `render()` and the three bypass call sites restores the previous empty-success behaviour.
diff --git a/src/tools/README.md b/src/tools/README.md
index e6a7f76..c6c8f52 100644
--- a/src/tools/README.md
+++ b/src/tools/README.md
@@ -12,3 +12,14 @@ One file per tool. Each handler validates with zod, calls `assertSafeUrl` first,
 | `fetchWebBatch.ts` | `fetch_web_batch` | Up to 10 URLs, per-URL `{ok, content|error}`, per-item `deadline_ms` |
 
 Batch supports only the documented subset — single-fetch options stay single-fetch by contract.
+
+## Empty-extraction contract (`fetch_web`)
+
+A render that produces no usable text is an error, never a success body.
+
+- **Guard:** `guardEmptyExtraction(content, { url, type, domChars, source })` in `fetchWeb.ts` throws `FetchError` with code `empty.extraction` and the message `empty extraction for <url> via <source> [dom N chars, text M chars]`. `hasUsableExtraction()` holds the per-type rule.
+- **Single exit:** `render()` guards the result of `renderOnce()`, so every renderer branch (Browsh plain/DOM, HTTP-only, non-HTML direct, enhanced `processDomForType`) is covered. The stitch, archive-snapshot, and pdf paths bypass `render()` and call the same guard themselves.
+- **Type rule:** `markdown`/`plain`/`pdf` fail on whitespace-only output or output with no readable text (`hasReadableText()`); `type: "html"` fails only on a blank DOM, because its payload is markup.
+- **Fallback:** markdown conversion retries once from the full DOM (`convertMarkdownWithRetry`) when the readability pass narrowed to an empty shell while the DOM still held text, and only then fails.
+- **Cache:** `pageCache` stores only content the guard already accepted; an empty body is never cached.
+
diff --git a/src/tools/fetchWeb.ts b/src/tools/fetchWeb.ts
index 36c964a..2f5cc70 100644
--- a/src/tools/fetchWeb.ts
+++ b/src/tools/fetchWeb.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/tools/README.md | Decisions: src/tools/DECISIONS.md
 import { browshManager } from "../browshManager.js";
 import { html2markdownConvert } from "../html2markdownManager.js";
 import { extractPdf } from "./extractPdf.js";
@@ -16,6 +17,7 @@ import {
   stripLinks,
   stripMedia,
   applyOffset,
+  hasReadableText,
 } from "../extract.js";
 import { FetchError, createDeadlineError } from "../errors.js";
 import {
@@ -72,6 +74,65 @@ const HTML_CONTENT_TYPES = [
   "text/xml",
 ];
 
+/**
+ * Result of one render pass: the produced content plus the facts needed to
+ * describe an empty extraction honestly (DOM size and the renderer branch).
+ */
+export interface RenderResult {
+  /** Content produced for the requested `type`. */
+  content: string;
+  /** Char length of the rendered DOM the content came from (0 when the path never fetched one). */
+  domChars: number;
+  /** Renderer branch label used in the empty-extraction diagnostic. */
+  source: string;
+}
+
+/** Stable machine-readable code for a render that produced no usable text. */
+export const EMPTY_EXTRACTION_CODE = "empty.extraction";
+
+/** Context carried into the empty-extraction guard. */
+export interface EmptyExtractionContext {
+  url: string;
+  /** Requested output type: plain | html | markdown | pdf. */
+  type: string;
+  /** Char length of the rendered DOM (0 when the path never fetched one). */
+  domChars: number;
+  /** Renderer branch label (e.g. browsh-markdown, archive-snapshot, stitch). */
+  source: string;
+}
+
+/**
+ * Per-type usability rule for extracted content.
+ *
+ * - `html`: the payload is markup, so a DOM shell with no visible text is still
+ *   content worth serving (callers inspect the shell). Only a blank DOM fails.
+ * - every text type (plain/markdown/pdf): whitespace-only output fails, and so
+ *   does output with no readable text after markup stripping.
+ *
+ * Pure, so the contract is testable without Browsh or html2markdown.
+ */
+export function hasUsableExtraction(content: string, type: string): boolean {
+  if (content.trim().length === 0) return false;
+  if (type === "html") return true;
+  return hasReadableText(content);
+}
+
+/**
+ * Single empty-extraction guard. Throws a `FetchError` (code
+ * `empty.extraction`) when a render produced no usable text, naming the URL,
+ * the renderer branch, the rendered DOM size, and the extracted text size.
+ *
+ * Never returns an error string: a failed extraction is an error, not a
+ * success body (AGENTS.md guardrail, DESIGN.md error style).
+ */
+export function guardEmptyExtraction(content: string, ctx: EmptyExtractionContext): void {
+  if (hasUsableExtraction(content, ctx.type)) return;
+  throw new FetchError(
+    `empty extraction for ${ctx.url} via ${ctx.source} [dom ${ctx.domChars} chars, text ${content.trim().length} chars]`,
+    { url: ctx.url, code: EMPTY_EXTRACTION_CODE }
+  );
+}
+
 interface SniffResult {
   contentType: string;
   isHtml: boolean;
@@ -267,6 +328,27 @@ function handleSinceLast(url: string, content: string, enabled?: boolean): { con
 // DOM → final content processing (toc/section/markdown conversion/focus/probe)
 // ---------------------------------------------------------------------------
 
+/**
+ * Converts HTML to markdown, retrying once from the full DOM when the
+ * readability pass narrowed to an empty shell while the DOM still holds
+ * readable text. The retry is the fallback the task file asks for before the
+ * exit guard fails a page loudly.
+ */
+async function convertMarkdownWithRetry(
+  sourceHtml: string,
+  fullDom: string,
+  url: string,
+  baseLabel: string
+): Promise<{ markdown: string; source: string }> {
+  let markdown = await html2markdownConvert(sourceHtml, { domain: url });
+  if (hasUsableExtraction(markdown, "markdown")) return { markdown, source: baseLabel };
+  // Readability found no text in the narrowed fragment; only a full-DOM retry
+  // is justified when the untouched DOM still carries readable text.
+  if (!hasReadableText(fullDom)) return { markdown, source: baseLabel };
+  markdown = await html2markdownConvert(fullDom, { domain: url });
+  return { markdown, source: `${baseLabel}+full-dom-retry` };
+}
+
 async function processDomForType(dom: string, url: string, opts: FetchWebOptions): Promise<string> {
   const { type, selector, focus, toc, section, must_contain, links, media } = opts;
 
@@ -329,7 +411,14 @@ async function processDomForType(dom: string, url: string, opts: FetchWebOptions
     } else {
       htmlForMd = extractMainHtml(sourceHtml ?? dom);
     }
-    let md = await html2markdownConvert(htmlForMd, { domain: url });
+    // No selector: the readability pass may have narrowed to an empty shell,
+    // so allow the single full-DOM retry before the exit guard can fail.
+    let md: string;
+    if (selector) {
+      md = await html2markdownConvert(htmlForMd, { domain: url });
+    } else {
+      md = (await convertMarkdownWithRetry(htmlForMd, dom, url, "browsh-markdown")).markdown;
+    }
     if (focus) md = focusFilter(md, focus);
     if (links === false) md = stripLinks(md);
     if (media === false) md = stripMedia(md);
@@ -471,6 +560,9 @@ async function fetchWebInner(opts: FetchWebOptions): Promise<string> {
       return out;
     }
     const text = await extractPdf(url);
+    // PDF text leaves the extractor here; an empty extraction must not be
+    // cached or returned as a success.
+    guardEmptyExtraction(text, { url, type: "pdf", domChars: 0, source: "pdf-pdftotext" });
     pageCache.set(pdfKey, text);
     let out = text;
     if (offset) out = applyOffset(out, offset);
@@ -522,6 +614,9 @@ async function fetchWebInner(opts: FetchWebOptions): Promise<string> {
   if (opts.stitch && type === "markdown") {
     try {
       const rawStitched = await fetchStitchedMarkdown(url, opts);
+      // Stitch bypasses render(): guard it here so a multi-page flow cannot
+      // return an empty body as a success either.
+      guardEmptyExtraction(rawStitched, { url, type, domChars: 0, source: "stitch" });
       // Cache clean rendered content BEFORE slicing transforms
       pageCache.set(key, rawStitched);
       // Slicing/transforms happen on read path after cache retrieval
@@ -668,6 +763,14 @@ async function processArchiveSnapshot(snap: WaybackSnapshot, opts: FetchWebOptio
     if (opts.links === false) content = stripLinks(content);
     if (opts.media === false) content = stripMedia(content);
   }
+  // An archived snapshot that yields no usable text is the same failure as a
+  // live one — guard it before the banner can mask the empty body.
+  guardEmptyExtraction(content, {
+    url,
+    type: opts.type,
+    domChars: snap.html.length,
+    source: "archive-snapshot",
+  });
   const dateStr = snap.timestamp ? `${snap.timestamp.slice(0, 4)}-${snap.timestamp.slice(4, 6)}-${snap.timestamp.slice(6, 8)}` : snap.timestamp;
   return `> [archive snapshot from ${dateStr} via Wayback Machine — live fetch failed, serving archived copy: ${snap.url}]\n\n${content}`;
 }
@@ -678,17 +781,27 @@ async function render(opts: FetchWebOptions): Promise<string> {
   const deadline = (wait_ms ?? 0) > 0 ? Date.now() + wait_ms! : 0;
 
   let previous = "";
-  let current = "";
+  // Seeded so the loop result is always defined for the guard below.
+  let current: RenderResult = { content: "", domChars: 0, source: "unrendered" };
   for (;;) {
     current = await renderOnce(opts);
-    if (deadline === 0 || Date.now() >= deadline || current === previous) break;
-    previous = current;
+    if (deadline === 0 || Date.now() >= deadline || current.content === previous) break;
+    previous = current.content;
     await new Promise((r) => setTimeout(r, SETTLE_INTERVAL_MS));
   }
-  return current;
+  // Single exit guard: every renderer branch funnels through here, so no type
+  // can return an empty body as a success — and the caller caches only what
+  // this guard already accepted.
+  guardEmptyExtraction(current.content, {
+    url: opts.url,
+    type: opts.type,
+    domChars: current.domChars,
+    source: current.source,
+  });
+  return current.content;
 }
 
-async function renderOnce(opts: FetchWebOptions): Promise<string> {
+async function renderOnce(opts: FetchWebOptions): Promise<RenderResult> {
   const { url, type, selector, tier } = opts;
 
   // pdf is handled entirely in fetchWeb() before render() is ever called. If
@@ -727,10 +840,14 @@ async function renderOnce(opts: FetchWebOptions): Promise<string> {
         if (opts.must_contain) {
           const probe = probeMustContain(text, opts.must_contain);
           const excerpts = probe.excerpts.length > 0 ? probe.excerpts.map((e, i) => `${i + 1}. ${e}`).join("\n") : "_(no context)_";
-          return `${probe.verdict} for "${opts.must_contain}" (${url})\n\n${excerpts}`;
+          return {
+            content: `${probe.verdict} for "${opts.must_contain}" (${url})\n\n${excerpts}`,
+            domChars: text.length,
+            source: "http-direct-probe",
+          };
         }
         // links/media not relevant for non-HTML (JSON/text)
-        return truncate(text, opts.max_chars);
+        return { content: truncate(text, opts.max_chars), domChars: text.length, source: "http-direct" };
       } catch (e) {
         // Axios throws ERR_BAD_RESPONSE when maxContentLength is exceeded.
         if (axios.isAxiosError(e) && e.code === "ERR_BAD_RESPONSE") {
@@ -762,11 +879,11 @@ async function renderOnce(opts: FetchWebOptions): Promise<string> {
       if (!isHtml) {
         let text = String(res.data);
         if (opts.focus) text = focusFilter(text, opts.focus);
-        return text;
+        return { content: text, domChars: text.length, source: "http-only" };
       }
       // For HTML via HTTP-only, convert directly without Browsh (may miss JS content — honest limitation of tier 1)
       const dom = String(res.data);
-      return processDomForType(dom, url, opts);
+      return { content: await processDomForType(dom, url, opts), domChars: dom.length, source: "http-only-dom" };
     } catch (e) {
       if (e instanceof FetchError) throw e;
       throw new FetchError(`tier 1: HTTP-only fetch failed for ${url}: ${e instanceof Error ? e.message : String(e)}`, { url });
@@ -775,7 +892,9 @@ async function renderOnce(opts: FetchWebOptions): Promise<string> {
 
   // plain without selector and without enhanced params → Browsh terminal text (fast path)
   if (type === "plain" && !selector && !opts.toc && !opts.section && !opts.focus && !opts.must_contain) {
-    return browshManager.fetchPlain(url);
+    // Terminal text path: no DOM is captured, so domChars stays 0 and the
+    // guard reports the renderer branch honestly.
+    return { content: await browshManager.fetchPlain(url), domChars: 0, source: "browsh-plain" };
   }
 
   const dom = await browshManager.fetchDom(url);
@@ -785,7 +904,7 @@ async function renderOnce(opts: FetchWebOptions): Promise<string> {
   // For simple html/plains without enhanced params, keep legacy fast logic but reuse processor for consistency.
   const hasEnhanced = opts.toc || opts.section || opts.focus || opts.must_contain || opts.links === false || opts.media === false;
   if (hasEnhanced) {
-    return processDomForType(dom, url, opts);
+    return { content: await processDomForType(dom, url, opts), domChars: dom.length, source: "browsh-dom" };
   }
 
   if (type === "html") {
@@ -794,24 +913,32 @@ async function renderOnce(opts: FetchWebOptions): Promise<string> {
       if (html === null) {
         throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
       }
-      return html;
+      return { content: html, domChars: dom.length, source: "browsh-html-selector" };
     }
-    return dom;
+    return { content: dom, domChars: dom.length, source: "browsh-html" };
   }
 
   if (type === "markdown") {
     let source = dom;
+    let sourceLabel = "browsh-markdown";
     if (selector) {
       const html = selectHtml(dom, selector);
       if (html === null) {
         throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
       }
       source = html;
+      sourceLabel = "browsh-markdown-selector";
     } else {
       // Boilerplate stripping when no explicit selector is given.
       source = extractMainHtml(dom);
     }
-    return html2markdownConvert(source, { domain: url });
+    if (selector) {
+      return { content: await html2markdownConvert(source, { domain: url }), domChars: dom.length, source: sourceLabel };
+    }
+    // No selector: readability can narrow to an empty shell, so allow the
+    // single full-DOM retry before the exit guard fails the page loudly.
+    const converted = await convertMarkdownWithRetry(source, dom, url, sourceLabel);
+    return { content: converted.markdown, domChars: dom.length, source: converted.source };
   }
 
   // plain + selector → extract text from the rendered DOM (enhanced case already handled)
@@ -819,7 +946,7 @@ async function renderOnce(opts: FetchWebOptions): Promise<string> {
   if (text === null) {
     throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
   }
-  return text;
+  return { content: text, domChars: dom.length, source: "browsh-plain-selector" };
 }
 
 function settleKey(o: FetchWebOptions): string {
diff --git a/tests/empty-extraction-guard-tests.ts b/tests/empty-extraction-guard-tests.ts
new file mode 100644
index 0000000..0bd6a3d
--- /dev/null
+++ b/tests/empty-extraction-guard-tests.ts
@@ -0,0 +1,169 @@
+/**
+ * Empty-extraction guard regression tests (fetch_web silent empty body).
+ * Run with: npx tsx tests/empty-extraction-guard-tests.ts
+ *
+ * Scope: no live network, no Browsh, no html2markdown binary. The renderer is
+ * stubbed at the seam the guard sees — a render result carrying the produced
+ * content, the rendered DOM char count, and the renderer branch label — so the
+ * contract "empty extraction never returns as success" is provable on a host
+ * where the external binaries are absent.
+ *
+ * Covered behaviour:
+ *  - hasReadableText() classifies markup, whitespace, script/style-only shells
+ *  - guardEmptyExtraction() rejects whitespace-only text output with the
+ *    stable code `empty.extraction` and a diagnostic naming url, renderer
+ *    branch, DOM chars and extracted text chars
+ *  - guardEmptyExtraction() keeps the html exemption (markup passes even with
+ *    no visible text) and still rejects a blank DOM
+ *  - a healthy ~17 KB markdown body passes untouched
+ */
+
+import { hasReadableText } from "../src/extract.js";
+import { guardEmptyExtraction } from "../src/tools/fetchWeb.js";
+import { FetchError } from "../src/errors.js";
+
+// ── Harness (mirrors tests/qa-boundary-tests.ts) ───────────────────────────
+
+let failures = 0;
+
+function check(name: string, passed: boolean, detail = ""): void {
+  if (passed) {
+    console.log(`${name}: PASS`);
+  } else {
+    failures++;
+    console.log(`${name}: FAIL${detail ? ` — ${detail}` : ""}`);
+  }
+}
+
+/** Runs `fn` and reports whether it threw a FetchError with the expected code. */
+function throwsEmptyExtraction(fn: () => void): { threw: boolean; error: unknown } {
+  try {
+    fn();
+    return { threw: false, error: null };
+  } catch (e) {
+    return { threw: true, error: e };
+  }
+}
+
+/**
+ * Renderer stub: exactly the shape renderOnce produces for a JS-heavy SPA that
+ * renders a large DOM but yields one newline of text (the observed failure).
+ */
+function stubEmptyRenderer(): { content: string; domChars: number; source: string } {
+  return { content: "\n", domChars: 48_210, source: "browsh-markdown" };
+}
+
+const OBSERVED_URL = "https://platform.openai.com/docs/api-reference/moderations";
+
+// ── hasReadableText ────────────────────────────────────────────────────────
+
+console.log("=== hasReadableText ===");
+
+check("empty string has no readable text", hasReadableText("") === false);
+check("whitespace-only markup has no readable text", hasReadableText("\n\n   \t\n") === false);
+check(
+  "script/style-only shell has no readable text",
+  hasReadableText("<html><body><script>var a=1;</script><style>.a{color:red}</style><div id=\"root\"></div></body></html>") === false
+);
+check(
+  "paragraph markup has readable text",
+  hasReadableText("<main><h1>Moderation</h1><p>The moderations endpoint classifies text.</p></main>") === true
+);
+
+// ── guardEmptyExtraction: text types ───────────────────────────────────────
+
+console.log("=== guardEmptyExtraction (markdown / plain) ===");
+
+const stubbed = stubEmptyRenderer();
+const emptyMarkdown = throwsEmptyExtraction(() =>
+  guardEmptyExtraction(stubbed.content, {
+    url: OBSERVED_URL,
+    type: "markdown",
+    domChars: stubbed.domChars,
+    source: stubbed.source,
+  })
+);
+
+check("stubbed empty renderer throws", emptyMarkdown.threw);
+check(
+  "throw is a FetchError with code empty.extraction",
+  emptyMarkdown.error instanceof FetchError &&
+    (emptyMarkdown.error as FetchError).code === "empty.extraction",
+  `got ${emptyMarkdown.error instanceof Error ? `${emptyMarkdown.error.name}/${(emptyMarkdown.error as FetchError).code}` : String(emptyMarkdown.error)}`
+);
+
+const message = emptyMarkdown.error instanceof Error ? emptyMarkdown.error.message : "";
+check("message names the url", message.includes(OBSERVED_URL), message);
+check("message names the renderer branch", message.includes("browsh-markdown"), message);
+check("message reports the rendered DOM size", message.includes("48210"), message);
+check("message reports the extracted text size", message.includes("text 0 chars"), message);
+
+const whitespaceOnly = throwsEmptyExtraction(() =>
+  guardEmptyExtraction("   \n\t \n", {
+    url: OBSERVED_URL,
+    type: "markdown",
+    domChars: 1200,
+    source: "browsh-markdown",
+  })
+);
+check("whitespace-only markdown throws", whitespaceOnly.threw);
+
+const plainEmpty = throwsEmptyExtraction(() =>
+  guardEmptyExtraction("", { url: OBSERVED_URL, type: "plain", domChars: 0, source: "browsh-plain" })
+);
+check("empty plain output throws", plainEmpty.threw);
+
+const healthyMarkdown = `${"# Moderation API\n\nThe moderations endpoint classifies text and image inputs.\n\n".repeat(220)}`;
+check(
+  "healthy ~17 KB markdown passes untouched",
+  (() => {
+    try {
+      guardEmptyExtraction(healthyMarkdown, {
+        url: "https://docs.avalai.ir/en/api-reference/moderation",
+        type: "markdown",
+        domChars: 180_000,
+        source: "browsh-markdown",
+      });
+      return healthyMarkdown.length > 16_000;
+    } catch {
+      return false;
+    }
+  })()
+);
+
+// ── guardEmptyExtraction: html exemption ───────────────────────────────────
+
+console.log("=== guardEmptyExtraction (html exemption) ===");
+
+const htmlShell = '<html><body><div id="root"></div></body></html>';
+check(
+  "html markup with no visible text passes (shell diagnosis preserved)",
+  (() => {
+    try {
+      guardEmptyExtraction(htmlShell, {
+        url: OBSERVED_URL,
+        type: "html",
+        domChars: htmlShell.length,
+        source: "browsh-html",
+      });
+      return true;
+    } catch {
+      return false;
+    }
+  })()
+);
+
+const blankHtml = throwsEmptyExtraction(() =>
+  guardEmptyExtraction("   ", { url: OBSERVED_URL, type: "html", domChars: 3, source: "browsh-html" })
+);
+check("blank html throws", blankHtml.threw);
+
+// ── Summary ────────────────────────────────────────────────────────────────
+
+console.log("=== Summary ===");
+if (failures > 0) {
+  console.log(`Overall: ${failures} check(s) FAILED`);
+  process.exit(1);
+}
+console.log("Overall: ALL PASS");
+process.exit(0);
```
<!-- END_GIT_DIFF -->
