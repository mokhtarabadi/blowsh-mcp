# Task 21: QA follow-up locks (Hebrew/CJK, wrapper-div, typing)

**File:** `tasks/qa/21-qa-followup-locks.md`
**Source:** manager
**Type:** bugfix
**Status:** in-progress
**Mode:** autopilot (locked 2026-10-19)

## Goal

Close the non-blocking QA/Review follow-ups from task 20: Hebrew/CJK locks (M1), wrapper-div multi-lang fixture (M2), monolingual ranking preservation lock (M3), proper Cheerio typing for `langBonus` (R1).

## Context

Task 20 QA_PASSED + Review APPROVED with noted follow-ups: V1 untagged pages fall back to length ranking (by design — lock it), V2 wrapper div containing all languages can outscore a single lang-matched paragraph (fix: mixed-language containers get no lang bonus), V3 2-char token filter (by design — lock it), V4 `$(el as never)` obscure cast (R1: type properly).

## Local TODOs

- [x] Mixed-language container penalty in `extractMainHtml` (no bonus when descendants carry a different explicit `lang`)
- [x] Proper Element typing for `langBonus`
- [x] Hebrew/CJK + wrapper-div + monolingual locks in regression tests
- [x] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] Wrapper with mixed langs loses to lang-matched paragraph
- [x] Hebrew/CJK queries yield tokens; 2-char filter behavior locked
- [x] Monolingual no-lang ranking preserved (first/longest wins)
- [x] Existing suites stay green, `npm run build` passes

## Definition of Done

- [x] Fix in `src/extract.ts` (+ tests)
- [x] CHANGELOG.md entry added

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: TBD
- Exit code: TBD

## Execution Log & Reasoning

2026-10-19 [AUTOPILOT] [PLAN]: Brain blueprint approved (mixed-lang penalty + Element typing + locks).
2026-10-19 [AUTOPILOT] [EXECUTION]: red proof first (wrapper leaks Russian), then mixed-lang container penalty + `domhandler` Element typing in `src/extract.ts`. Suites: multilingual 17/17, hardening 9/9, parser 11/11. `npm run build` exit 0 verified unpiped (pipes mask tsc failures — caught a real TS2305 this way).

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — tsc strict clean (unpiped exit 0); multilingual 17/17, hardening 9/9, parser 11/11
- Exit code: 0

## Risk & Rollback

Low risk, scorer-only change. Rollback via git checkout of `src/extract.ts`.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 6b0a0ad..319b32a 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -6,6 +6,7 @@
 
 - Search parser hardening: removed generic `a[href]` fallbacks in Brave/Mojeek parsers (strict organic containers with snippet sibling + deny-list), `isBlockedPage` structural signals now win over stale organic containers, Google `/url?q=` rescue deny-listed, query-relevance guard drops zero-overlap garbage before merge. New `tests/search-parser-hardening-regression.ts` (9 checks).
 - Multilingual quality gaps: `passesRelevanceGuard` tokenizer is now Unicode-aware (`\p{L}` + numbers), so Persian/Arabic/Cyrillic queries yield tokens instead of slipping through the empty exemption; `extractMainHtml` prefers page-language paragraphs, so multi-lang pages return English instead of the longest non-English paragraph. New `tests/multilingual-relevance-guard-regression.ts` (8 checks).
+- QA follow-ups: mixed-language wrapper containers get no lang bonus (narrowest matched paragraph wins), `langBonus` properly typed via `domhandler` Element, Hebrew/CJK/wrapper-mono locks added (multilingual suite now 17 checks).
 - Version drift: AGENTS.md overview now states current 2.6.0; docs/architecture.md structure header, diagram, §3.1, and distribution tag unified on 2.6.0 (matches package.json and src/server.ts).
 - Clock-injection scope: docs/conventions.md now exempts in-memory TTL/elapsed-time `Date.now()` use (no durable timestamps in this server); ban applies if durable scheduling is introduced.
 - Folder docs + env: src/README.md and src/tools/README.md added; .env.example documents ENRICH_BUDGET_MS (now env-overridable, default 45000) and correct MCP_TRANSPORT values; task-number prose already clean outside allowed homes.
diff --git a/src/extract.ts b/src/extract.ts
index c801da1..5d75080 100644
--- a/src/extract.ts
+++ b/src/extract.ts
@@ -1,4 +1,5 @@
 import { load, type CheerioAPI } from "cheerio";
+import type { Element } from "domhandler";
 
 const NOISE_SELECTORS = [
   "script",
@@ -50,10 +51,20 @@ export function extractMainHtml(html: string): string {
   stripNoise($);
 
   const pageLang = (($("html").attr("lang") || "en").split(/[-_]/)[0] ?? "en").toLowerCase();
-  const langBonus = (el: unknown): number => {
-    const lang = $(el as never).closest("[lang]").attr("lang");
-    if (!lang) return 10_000;
-    return (lang.split(/[-_]/)[0] ?? "").toLowerCase() === pageLang ? 10_000 : 0;
+  const langOf = (lang: string | undefined): string => (lang ?? "").split(/[-_]/)[0]?.toLowerCase() ?? "";
+  const langBonus = (el: Element): number => {
+    const own = langOf($(el).closest("[lang]").attr("lang"));
+    if (!own) return 10_000;
+    if (own !== pageLang) return 0;
+    // Mixed-language container: descendants carrying a different explicit
+    // lang mean no single language wins — fall back to length ranking so a
+    // wrapper holding every translation cannot beat one matched paragraph.
+    let mixed = false;
+    $(el).find("[lang]").each((_, desc) => {
+      const sub = langOf($(desc).attr("lang"));
+      if (sub && sub !== pageLang) mixed = true;
+    });
+    return mixed ? 0 : 10_000;
   };
 
   const candidates: string[] = ["main", "article", '[role="main"]', '[id="content"]', '[id="main"]', '[class*="content"]'];
diff --git a/tests/multilingual-relevance-guard-regression.ts b/tests/multilingual-relevance-guard-regression.ts
index ddddadc..2c654a6 100644
--- a/tests/multilingual-relevance-guard-regression.ts
+++ b/tests/multilingual-relevance-guard-regression.ts
@@ -57,6 +57,55 @@ const main = extractMainHtml(MULTI_LANG_HTML);
 check("multi-lang extraction prefers english paragraph", main.includes("documentation examples"));
 check("multi-lang extraction does not pick russian paragraph", !main.includes("Данный домен"));
 
+// ── Follow-ups: Hebrew/CJK, wrapper-div, monolingual ranking ───────────────
+
+check(
+  "hebrew query yields tokens",
+  passesRelevanceGuard("מחיר הדולר היום", "שער החליפין", "https://example.com/fx", "מחיר הדולר היום בתל אביב") === true
+);
+check(
+  "cjk query yields tokens",
+  passesRelevanceGuard("美元今日价格走势", "外汇汇率", "https://example.com/fx", "美元今日价格走势") === true
+);
+check(
+  "2-char cjk query stays exempt by design",
+  passesRelevanceGuard("unrelated english title", "unrelated snippet", "https://example.com/x", "美元") === true
+);
+
+const WRAPPER_HTML = `
+<html lang="en"><head><title>Wrapped</title></head><body>
+<div class="wrap">
+<p lang="en">This domain is for use in documentation examples without needing permission from authorities.</p>
+<p lang="ru">Данный домен предназначен для использования в примерах документации без необходимости разрешения.</p>
+</div>
+</body></html>
+`;
+
+const wrapped = extractMainHtml(WRAPPER_HTML);
+check("mixed-lang wrapper loses to english paragraph", wrapped.includes("documentation examples"));
+check("mixed-lang wrapper does not leak russian", !wrapped.includes("Данный домен"));
+
+const MONO_HTML = `
+<html><head><title>Mono</title></head><body>
+<p>Short note.</p>
+<p>This is the longest paragraph on this monolingual page by a clear margin, so length ranking must pick it.</p>
+<p>Medium paragraph with some more words here.</p>
+</body></html>
+`;
+
+const mono = extractMainHtml(MONO_HTML);
+check("monolingual ranking picks longest paragraph", mono.includes("longest paragraph"));
+
+const TIE_HTML = `
+<html><head><title>Tie</title></head><body>
+<p>First paragraph with exactly thirty characters!!</p>
+<p>Second paragraph with exactly thirty characters!</p>
+</body></html>
+`;
+
+const tied = extractMainHtml(TIE_HTML);
+check("monolingual tie keeps first paragraph", tied.includes("First paragraph"));
+
 console.log(`\n${passed} checks passed`);
 if (process.exitCode) {
   process.exit(process.exitCode);
```
<!-- END_GIT_DIFF -->
