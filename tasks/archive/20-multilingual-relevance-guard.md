# Task 20: Search + fetch quality gaps (multilingual guard, markdown lang pick)

**File:** `tasks/completed/20-multilingual-relevance-guard.md`
**Source:** manager
**Type:** bugfix
**Status:** closed
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
2026-10-19 [PO_REVIEW_PENDING]: QA PASSED + Code Reviewer APPROVED technically (8+9+11 green, build clean). Manager accept quote: "Approved for closure".

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — tsc strict clean; multilingual 8/8, hardening 9/9, parser 11/11
- Exit code: 0

## Risk & Rollback

Low risk, one-function change. Rollback via git checkout of `src/tools/searchWeb.ts`.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `bed408ef4aadfab9adbc99c7d68d297a81e73ae7`
<!-- END_GIT_DIFF -->
