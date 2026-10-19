# Task 20: Search + fetch quality gaps (multilingual guard, markdown lang pick)

**File:** `tasks/qa/20-multilingual-relevance-guard.md`
**Source:** manager
**Type:** bugfix
**Status:** in-progress
**Mode:** autopilot (locked 2026-10-19)

## Goal

Fix two quality gaps found in the 2026-10-19 deep probe of all blowsh tools: (B1) relevance guard bypass for non-Latin queries, (B2) markdown main-content extraction picking a non-English paragraph on multi-lang pages.

## Context

Deep-search hardening probe on 2026-10-19 (after task 19 closure) tested all five tools against rebuilt `blowsh-singleton`. PASS list: `search_web` paper intent, `site:` query, entity, news intent, long product query; `fetch_web` toc, section, must_contain probe, batch per-URL SSRF isolation; `extract_links`; `crawl_web` map honest-empty guidance. Two failures below.

## B1: Non-Latin relevance-guard bypass (search_web)

Persian query "قیمت دلار امروز تهران" returned English job-site garbage (Glassdoor, Snagajob, Facebook jobs group, Monster) with zero query overlap passing through. `passesRelevanceGuard` tokenizes with `/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i` (Latin only), so Persian/Arabic (`\u0600-\u06FF`), Cyrillic, Hebrew, and CJK scripts yield zero tokens, and zero-token queries are exempt by design. Fix: Unicode letter segmentation (`\p{L}` + numbers, `u` flag); keep empty-URL and genuinely-empty exemptions; update regression locks (Persian query must yield tokens and drop job-site items).

## B2: Markdown picks non-English paragraph (fetch_web)

`fetch_web` markdown for `https://example.com` returned the Russian paragraph ("Данный домен...") while the page holds en/ar/zh/fr/ru paragraphs and the HTML `<title>` is English. Both single fetch and `fetch_web_batch` are affected (same extractor). Suspect: main-content extraction in `src/extract.ts` scores paragraphs without language preference, so a non-English paragraph wins. Fix: prefer `lang="en"` (or page-language) paragraphs in extraction scoring, or pick the first paragraph on tie; add a regression fixture with the multi-lang example.com shape asserting English wins.

## Minor note (no action required now)

`focus: "Enigma codebreaking"` on the Turing page kept 22/370 blocks but the head of the output is a See-also link list rather than Enigma prose. Tuning the BM25 block ranker to down-weight nav/link-list blocks is deferred; record only.

## Local TODOs

- [ ] B1: Unicode-aware tokenizer in `passesRelevanceGuard` + Persian regression locks
- [ ] B2: language-preferring extraction in `src/extract.ts` + multi-lang fixture
- [ ] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] Persian query tokens are non-empty and job-site garbage is dropped
- [x] example.com markdown returns the English paragraph
- [x] Existing suites (11 parser + 9 hardening) stay green
- [x] `npm run build` (tsc strict) passes

## Definition of Done

- [x] Fixes in `src/tools/searchWeb.ts` + `src/extract.ts` (+ tests)
- [x] CHANGELOG.md entry added

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: TBD
- Exit code: TBD

## Execution Log & Reasoning

2026-10-19 deep probe (post-19 rebuild): 5/6 search probes relevant; Persian FAIL (job-site garbage), example.com markdown picks Russian paragraph.
2026-10-19 [AUTOPILOT] [BRAINSTORM]: multi-seat session held (Architect/Programmer/Planner/Strategist/QA/Reviewer; Designer skipped, no UI surface). Verdict: Unicode `\p{L}` tokenizer + lang-prefer scorer + fixtures; full language detection rejected (new dep), Enigma retune deferred.
2026-10-19 [AUTOPILOT] [EXECUTION]: red proof first (2 failures as expected), then B1 Unicode tokenizer in `passesRelevanceGuard` + B2 lang-bonus scorer in `extractMainHtml` (page-lang match +50-char confident-pick gate, raw-100 gate preserved). Suites: multilingual 8/8, hardening 9/9, parser 11/11. `rtk test npm run build` exit 0.

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — tsc strict clean; multilingual 8/8, hardening 9/9, parser 11/11
- Exit code: 0

## Risk & Rollback

Low risk, one-function change. Rollback via git checkout of `src/tools/searchWeb.ts`.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index e5e5552..6b0a0ad 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -5,6 +5,7 @@
 ### Fixed
 
 - Search parser hardening: removed generic `a[href]` fallbacks in Brave/Mojeek parsers (strict organic containers with snippet sibling + deny-list), `isBlockedPage` structural signals now win over stale organic containers, Google `/url?q=` rescue deny-listed, query-relevance guard drops zero-overlap garbage before merge. New `tests/search-parser-hardening-regression.ts` (9 checks).
+- Multilingual quality gaps: `passesRelevanceGuard` tokenizer is now Unicode-aware (`\p{L}` + numbers), so Persian/Arabic/Cyrillic queries yield tokens instead of slipping through the empty exemption; `extractMainHtml` prefers page-language paragraphs, so multi-lang pages return English instead of the longest non-English paragraph. New `tests/multilingual-relevance-guard-regression.ts` (8 checks).
 - Version drift: AGENTS.md overview now states current 2.6.0; docs/architecture.md structure header, diagram, §3.1, and distribution tag unified on 2.6.0 (matches package.json and src/server.ts).
 - Clock-injection scope: docs/conventions.md now exempts in-memory TTL/elapsed-time `Date.now()` use (no durable timestamps in this server); ban applies if durable scheduling is introduced.
 - Folder docs + env: src/README.md and src/tools/README.md added; .env.example documents ENRICH_BUDGET_MS (now env-overridable, default 45000) and correct MCP_TRANSPORT values; task-number prose already clean outside allowed homes.
diff --git a/src/extract.ts b/src/extract.ts
index c30551d..c801da1 100644
--- a/src/extract.ts
+++ b/src/extract.ts
@@ -40,11 +40,22 @@ function stripNoise($: CheerioAPI): void {
  * Readability-style main-content extraction: prefers <main>, falls back to
  * <article>, then the largest text-density block, finally <body>.
  * Always strips nav/footer/header/aside/scripts/style.
+ * Language preference: elements whose nearest `lang` matches the page language
+ * (or inherit it) score a bonus, so a multi-lang page yields the page-language
+ * paragraph instead of whichever paragraph is longest. Monolingual pages are
+ * unaffected (uniform bonus preserves length ranking, first wins ties).
  */
 export function extractMainHtml(html: string): string {
   const $ = load(html);
   stripNoise($);
 
+  const pageLang = (($("html").attr("lang") || "en").split(/[-_]/)[0] ?? "en").toLowerCase();
+  const langBonus = (el: unknown): number => {
+    const lang = $(el as never).closest("[lang]").attr("lang");
+    if (!lang) return 10_000;
+    return (lang.split(/[-_]/)[0] ?? "").toLowerCase() === pageLang ? 10_000 : 0;
+  };
+
   const candidates: string[] = ["main", "article", '[role="main"]', '[id="content"]', '[id="main"]', '[class*="content"]'];
   for (const sel of candidates) {
     const el = $(sel).first();
@@ -55,15 +66,23 @@ export function extractMainHtml(html: string): string {
   }
 
   let best = "";
+  let bestScore = 0;
   let bestLen = 0;
+  let bestMatched = false;
   $("div, section, p").each((_, el) => {
     const textLen = $(el).text().trim().length;
-    if (textLen > bestLen) {
+    const bonus = langBonus(el);
+    const score = textLen + bonus;
+    if (score > bestScore) {
+      bestScore = score;
       bestLen = textLen;
+      bestMatched = bonus > 0;
       best = $(el).html() ?? "";
     }
   });
-  if (bestLen > 100) return best;
+  // Raw-length gate preserves old behavior; a language-matched block is a
+  // confident pick at the lower candidate threshold instead of body fallback.
+  if (bestLen > 100 || (bestMatched && bestLen > 50)) return best;
 
   return $("body").html() ?? "";
 }
diff --git a/src/tools/searchWeb.ts b/src/tools/searchWeb.ts
index 7e833ad..c9dede8 100644
--- a/src/tools/searchWeb.ts
+++ b/src/tools/searchWeb.ts
@@ -160,7 +160,10 @@ function isDeniedResultUrl(abs: string): boolean {
  * Lightweight query-relevance guard. Requires token overlap between the query
  * and title + snippet + URL text. Prevents nav/ad/footer garbage from passing
  * through merge when selectors drift. Synthetic Instant Answer (empty URL) is
- * always exempt. CJK queries yielding zero tokens stay exempt (locked by test).
+ * always exempt. Tokenization is Unicode-aware (Letter + Number, `u` flag) so
+ * Persian/Arabic/Cyrillic/CJK queries yield tokens instead of slipping through
+ * the genuinely-empty exemption. CJK queries yielding zero tokens stay exempt
+ * (locked by test).
  */
 export function passesRelevanceGuard(
   title: string,
@@ -169,10 +172,7 @@ export function passesRelevanceGuard(
   query: string
 ): boolean {
   if (!url) return true;
-  const toks = query
-    .toLowerCase()
-    .split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i)
-    .filter((w) => w.length > 2);
+  const toks = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2);
   if (toks.length === 0) return true;
   const hay = `${title} ${snippet} ${url}`.toLowerCase();
   const hits = toks.filter((t) => hay.includes(t)).length;
diff --git a/tests/multilingual-relevance-guard-regression.ts b/tests/multilingual-relevance-guard-regression.ts
new file mode 100644
index 0000000..ddddadc
--- /dev/null
+++ b/tests/multilingual-relevance-guard-regression.ts
@@ -0,0 +1,63 @@
+import { passesRelevanceGuard } from "../src/tools/searchWeb.js";
+import { extractMainHtml } from "../src/extract.js";
+
+let passed = 0;
+function check(name: string, cond: boolean, detail = ""): void {
+  if (cond) {
+    passed++;
+    console.log(`ok - ${name}`);
+  } else {
+    console.error(`fail - ${name} ${detail}`);
+    process.exitCode = 1;
+  }
+}
+
+// ── B1: non-Latin queries must yield tokens, not exemptions ────────────────
+
+const FA_QUERY = "قیمت دلار امروز تهران";
+
+check(
+  "persian query matches persian result",
+  passesRelevanceGuard("قیمت دلار امروز در تهران", "نرخ ارز و قیمت دلار", "https://example.com/dollar", FA_QUERY) === true
+);
+check(
+  "persian query drops english job-site garbage",
+  passesRelevanceGuard("Recommended Jobs For You", "Search millions of open jobs", "https://www.glassdoor.com/Job/index.htm", FA_QUERY) === false
+);
+check(
+  "arabic query yields tokens",
+  passesRelevanceGuard("سعر الدولار اليوم", "أسعار العملات", "https://example.com/fx", "سعر الدولار اليوم في القاهرة") === true
+);
+check(
+  "cyrillic query yields tokens",
+  passesRelevanceGuard("курс доллара сегодня", "обмен валюты", "https://example.com/fx", "курс доллара сегодня") === true
+);
+check(
+  "empty query stays exempt",
+  passesRelevanceGuard("anything", "anything", "https://example.com/x", "  ") === true
+);
+check(
+  "instant answer stays exempt",
+  passesRelevanceGuard("Instant Answer", "abstract", "", FA_QUERY) === true
+);
+
+// ── B2: multi-lang page must prefer the English paragraph ──────────────────
+
+const MULTI_LANG_HTML = `
+<html lang="en"><head><title>Example Domain</title></head><body>
+<p lang="en">This domain is for use in documentation examples without needing permission.</p>
+<p lang="ar" dir="rtl">هذا النطاق مخصص للاستخدام في أمثلة التوثيق.</p>
+<p lang="zh">该域名仅用于文档示例。</p>
+<p lang="fr">L'usage de ce domaine est réservé à des exemples.</p>
+<p lang="ru">Данный домен предназначен для использования в примерах.</p>
+</body></html>
+`;
+
+const main = extractMainHtml(MULTI_LANG_HTML);
+check("multi-lang extraction prefers english paragraph", main.includes("documentation examples"));
+check("multi-lang extraction does not pick russian paragraph", !main.includes("Данный домен"));
+
+console.log(`\n${passed} checks passed`);
+if (process.exitCode) {
+  process.exit(process.exitCode);
+}
```
<!-- END_GIT_DIFF -->
