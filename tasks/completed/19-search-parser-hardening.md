# Task 19: Search parser hardening via SERP library study

**File:** `tasks/completed/19-search-parser-hardening.md`
**Source:** manager
**Type:** research+implementation
**Status:** closed
**Mode:** autopilot (locked 2026-10-19)

## Goal

Study famous SERP scraping libraries and fix irrelevant search results caused by brittle engine page parsing in `searchWeb.ts`.

## Context

Manager observed search links sometimes irrelevant to query, suspects engine page parsing is wrong. Executor live test on 2026-10-19 confirmed: `search_web` returned Chinese Zhihu results for "Node.js library scrape Google search results SERP parser" and Greek TV results for "open source metasearch SearXNG searx parsing Google Bing". Only the third query returned relevant SerpApi results. Finding points to Google/Brave/Mojeek parsers in `src/tools/searchWeb.ts` matching wrong DOM anchors (ads, related, nav) or failing to detect robot-block and falling through to garbage.

## Libraries To Study

- SearXNG (searxng/searxng, AGPL-3.0, 37k stars): per-engine parser files under `searx/engines/`, consensus merge, robot-block detection. Learn from, do not vendor (Python + AGPL incompatible).
- google-sr (typicalninja/google-sr, Apache-2.0, deprecated): modular TypeScript parsers per result type, no API key. Closest stack match, study selector strategy and no-js vs js split.
- serp-parser (zlurad/serp-parser, MIT): separate GoogleSERP vs GoogleNojsSERP and BingNojsSERP classes. Study dual-path approach.
- christophebe/serp (134 stars): Playwright + cookie consent + delay/retry/proxy. Study consent handling only, too heavy to vendor.
- SerpApi / Serper (paid APIs): JSON shape reference only, no dependency (external key, cost, offline violation).

## Decision: Use vs Learn

Learn, do not directly depend. Reasons: stack mismatch (SearXNG is Python AGPL), maintenance risk (google-sr deprecated, serp-parser stale selectors), paid external dependency violates offline Docker form factor, extra runtime weight (Playwright). Single allowed exception: if a small MIT snippet for one selector is vendored, isolate it with attribution comment and cover with regression test.

## Browsh Constraint (manager 2026-10-19)

We are Browsh + Firefox: search must render the SERP page then convert to markdown and extract links. This is our anti-block advantage over raw HTTP scraping, Google policy changes cannot block us as long as Firefox renders. Fixes must stay in Browsh DOM parsing, never regress to axios-only scraping.

## Local TODOs

- [ ] Map current parsers in `src/tools/searchWeb.ts` (Google, Startpage, DDG, Bing, Brave, Mojeek) with selectors
- [ ] Compare against google-sr and serp-parser selectors, note drift
- [ ] Fix irrelevant-result bug: strict organic anchors, block-list ads/nav, empty-on-block so fallback chain moves on
- [ ] Add regression test with saved SERP HTML fixtures
- [ ] Build and verify (`rtk test npm run build`)

## Acceptance Criteria

- [x] No irrelevant-language results for the three probe queries above
- [x] Blocked engine render resolves to empty, chain continues (no garbage passthrough)
- [x] `npm run build` (tsc strict) passes

## Definition of Done

- [x] Selectors fixed in `src/tools/searchWeb.ts`
- [x] Regression fixture test added and passing
- [x] CHANGELOG.md entry added

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: TBD
- Exit code: TBD

## Execution Log & Reasoning

2026-10-19 discovery: live probe confirmed irrelevant results on 2 of 3 queries.
2026-10-19 [AUTOPILOT] [EXECUTION]: graph built for src/tools (102 nodes); cloned google-sr + serp-parser to /tmp/opencode/ref (graph tool rejects outside-workspace paths, used file map instead); Brain plan approved; implemented strict organic anchors + deny-list + relevance guard in src/tools/searchWeb.ts; new tests/search-parser-hardening-regression.ts 7/7 pass; existing parser tests 11/11 pass; `rtk test npm run build` exit 0.
Assumption A1: "those two projects" = google-sr + serp-parser (closest TS stack); SearXNG used for pattern notes only.
2026-10-19 [AUTOPILOT] [QA-FIX]: Brain QA review demanded hostname-aware deny (docs survive), nav-title blocklist, length-aware relevance threshold, strong-title-before-organic with genuine-SERP guard. Applied; parser suite 11/11 + hardening 7/7 green.
2026-10-19 [PO_REVIEW_PENDING]: Code Reviewer APPROVED technically (QA PASSED, 9+11 green, build clean). Manager accept quote: "Approved for closure".

## Verification Evidence

- Test command: `rtk test npm run build`
- Expected result: exit 0
- Actual result: PASS — tsc strict clean; regression 7/7, parser suite 11/11
- Exit code: 0

## Manager Decisions

**[2026-10-19] [D1] [EXECUTOR-DETECTED]:** Learn-don't-vendor for SERP libraries.
- **Rationale:** AGPL/paid/Playwright/deprecated costs outweigh benefit; project is offline TypeScript Docker.
- **Alternatives considered:** Direct dependency on google-sr or SearXNG wrapper.
- **Impact:** Fix stays in `src/tools/searchWeb.ts` with borrowed patterns only.

## Risk & Rollback

Medium risk, touches search quality only. Rollback via git checkout of `src/tools/searchWeb.ts`.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `3c03ba37657bd2254612366859edc5829bad3f22`
<!-- END_GIT_DIFF -->
