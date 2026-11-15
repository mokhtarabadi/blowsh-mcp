# Task 261: `fetch_web` returns a silent empty success when the renderer extracts no text

**File:** `tasks/completed/261-fetch-web-silent-empty-body.md`
**Source:** manager
**Type:** bugfix
**Status:** closed
**Finished:** 2026-11-11T08:53:07Z
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
**Factual Git Diff:** Stored in Commit Hash: `7dfe41896186e70c971ad1d73ca224a208dc2907`
<!-- END_GIT_DIFF -->
