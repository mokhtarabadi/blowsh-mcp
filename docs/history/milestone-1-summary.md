# Milestone 1 Summary

**Date:** 2026-09-18
**Tasks Compacted:** 12
**Range:** v2.0.0 extended toolset → v2.4.0 release (ghcr published, CI green)

## Source Distribution

| Source | Count |
| ------ | ----- |
| manager | 12 |

## Architectural Changes

- 5-tool MCP surface over stdio: fetch_web, search_web, crawl_web, extract_links, fetch_web_batch; thin `tools/*` orchestrators over browshManager + html2markdownManager; cross-cutting SSRF/cache/extract/errors modules (SRP).
- Errors first-class: every tool throws `FetchError` (`FetchError: msg [http status]`, typed `code` incl. `deadline.hit`); `isError: true` envelope; `{url}` context on all instances.
- SSRF-first: DNS-resolved `assertSafeUrl` before any URL reaches Browsh, all tools incl. batch/search/pdf.
- Render pipeline: content-type sniff fast-path (non-HTML direct), tiered HTTP→browser escalation, wait_ms settle polling, TTL page cache + intent-aware query cache, batch per-URL isolation with per-item deadline_ms.
- Browser session health: FIFO mutex, request-count recycle + idle kill in quiescent windows, process-group teardown, HOME-redirected persistent profile, warm prewarm, bot-guard detection with per-host verdict cache + JSON stderr log.
- Search: 4-engine consensus + verticals (GitHub/arXiv/HN/Wikipedia), query_variants merged, pagination offsets, Instant Answer (empty-url accepted), deadline race with cheap-fallback partials and `deadline.hit`-or-partial precedence.
- Fetch extras: BM25 focus filter, toc/section, must_contain probe, Wayback auto/only with explicit outcome labels, rel=next stitching, since_last fingerprints, offset resume.
- Crawl: sitemap discovery, BM25 frontier, Governor pacing, robots compliance, resume tokens, quality/kind heuristics.
- Distribution: fat multi-stage Docker image (Firefox ESR + Browsh 1.8.0 + html2markdown + poppler-utils), ghcr.io published, GitHub Actions build+push+smoke on main and v* tags.

## Files Modified

| File | Change |
| ---- | ------ |
| src/server.ts | 5-tool registration, zod 4 schemas, routing, error envelope |
| src/browshManager.ts | Lifecycle, mutex, recycle/idle, timeouts, whitespace strip |
| src/html2markdownManager.ts | html2markdown CLI wrapper |
| src/ssrf.ts | assertSafeUrl guard |
| src/cache.ts | TTL page cache |
| src/extract.ts | Main-content, BM25 focus, toc/section, probe, stitch, offset |
| src/errors.ts | FetchError + typed code + deadline helpers |
| src/guard.ts | Bot-guard detection, verdict cache, logging |
| src/tools/fetchWeb.ts | All fetch options, archive outcomes, deadline race |
| src/tools/extractPdf.ts | SSRF-guarded PDF download + pdftotext |
| src/tools/searchWeb.ts | 4-engine consensus, verticals, variants, deadline precedence |
| src/tools/crawlWeb.ts | Sitemap crawl, frontier, pacing, resume |
| src/tools/extractLinks.ts | Noise-stripped absolute link extraction |
| src/tools/fetchWebBatch.ts | Sequential per-URL isolation + deadline passthrough |
| Dockerfile | Fat image + OCI labels + profile volume |
| .github/workflows/docker-publish.yml | Build, push, container smoke test |
| README.md / DESIGN.md / docs/* | Tool API, contracts, deployment, roadmap with owners |
| CHANGELOG.md | v2.0.0 → v2.4.0 entries |
| AGENTS.md / docs/conventions.md | Project rules, datetime/SOLID/ledger/DSP standards |
| opencode.json / .gitignore | Published-image config, sessions ignore |

## Criteria Met

| Task | Acceptance Criteria | Status |
| ---- | ------------------- | ------ |
| 01 | 4 tools, SSRF, cache, FetchError, Docker smoke, docs | ✅ Met |
| 02 | Pagination, Instant Answer, PDF type, session recycle, enrich, v2.1.0 | ✅ Met |
| 03 | ghcr public image, CI on main + v*, smoke, README/architecture/CHANGELOG, published-image config | ✅ Met |
| 04 | 5 bugs + 3 improvements (redirects, whitespace, sniff, noise strip, url context), build 0 | ✅ Met |
| 05 | 4 fixes verified present/committed/tagged v2.2.1; triage drop with proof | ✅ Met |
| 06 | focus/toc/probe/archive/stitch, crawl_web, variants/intent/deadline, v2.3.0, no regression | ✅ Met |
| 07 | Section hoist, arXiv withdrawn filter, news/entity fallback, deadline partials, 2.3.2 | ✅ Met |
| 08 | Profile persistence, prewarm, guard.ts 20/20 tests, viewport env, additive only | ✅ Met |
| 09 | Viewport study proven-negative, zero code changes, build 0 | ✅ Met |
| 10 | Batch per-URL isolation, archive outcomes, deadline.hit precedence, 22 tests, Docker live proof | ✅ Met |
| 11 | Focus seed + Instant Answer contracts, guard.ts docs, roadmap owners, no source change | ✅ Met |
| 12 | v2.4.0 bump, changelog stamp, tag+push, CI green, image published + smoked | ✅ Met |

## Individual Task Summaries

### Task 01: Blowsh-MCP v2.0 — Extended Search & Structured Extraction Toolset

- **Type:** feature | **Source:** manager
- **Reasoning:** Single fetcher → 4-tool deep-research set; modular layout (tools over managers, dedicated SSRF/cache/extract/errors); errors-as-thrown; SSRF before Browsh; fat Dockerfile; container-only verification; ~583 MiB peak RAM measured.

### Task 02: Blowsh-MCP v2.1 — Deep Research Gaps

- **Type:** feature | **Source:** manager
- **Reasoning:** Pagination with engine offset synthesis; DDG Instant Answer fast path; PDF folded into fetch_web via dedicated extractPdf module (text-only cache); busy-mutex recycle + idle timeout; opt-in enrich kept minimal.

### Task 03: Blowsh-MCP v2.2 — Registry Distribution & CI/CD

- **Type:** feature | **Source:** manager
- **Reasoning:** buildx + login + metadata + build-push chain on GITHUB_TOKEN; short-sha tag fix after first red run; public ghcr package verified anonymous; global config pointed at published image.

### Task 04: Fix All Bugs & Implement Improvements

- **Type:** bug | **Source:** manager
- **Reasoning:** Unified decodeRedirect (DDG/Bing/Google); pre-fetch content-type sniff fixes timeout waste; whitespace-only line strip; nav noise strip; url context on all FetchErrors; sequential batch documented intentional.

### Task 05: Release v2.2.1 — Bug Fixes and Improvements

- **Type:** feature | **Source:** manager
- **Reasoning:** Rebase-or-drop triage at v2.3.2: all 4 fixes grep-verified present, commit on origin/main, tag v2.2.1 pushed; dropped with proof, zero source changes.

### Task 06: DonSeTch Parity — Gap Implementation (v2.3.0)

- **Type:** feature | **Source:** manager
- **Reasoning:** Tool-surface adaptation (no Rust TLS/ghost parity possible): BM25 focus, toc/section, probe, archive, stitch; new crawl_web; variants/intent/deadline + Brave/Mojeek; 19/19 parity checks; backwards compatible.

### Task 07: Blowsh Self-Stress Fixes (2.3.2)

- **Type:** improvement | **Source:** manager
- **Reasoning:** hoistHeading climbs div.mw-heading; arXiv withdrawn regex + title-phrase rank; news/entity simplify+fallback; deadline cheap-fallback partials instead of bare error.

### Task 08: Browsh+ESR Hardening

- **Type:** improvement | **Source:** manager
- **Reasoning:** HOME-redirected profile with quarantine→fresh recovery; boot prewarm; guard.ts detector 20/20 fixtures, 1h host cache, additive HTML trailer only; zero shape change.

### Task 09: Browsh Viewport Study

- **Type:** improvement | **Source:** manager
- **Reasoning:** Proven-negative: columns config inert, COLUMNS env byte-identical, pty breaks renders, Marionette second-client wedges; sized-Firefox attach path left unmeasured; zero code changes.

### Task 10: Blowsh Live-Stress Defects

- **Type:** bug | **Source:** manager
- **Reasoning:** D3 real race (inner abort→[] wins) → typed deadline signal, precedence throw, variants rethrow; D2 Wayback silent null → explicit outcome labels; D1 contract (batch isolation kept, retry hint, per-item deadline); 22 stubbed tests; Docker live proof all three.

### Task 11: Blowsh Docs and Contract Gaps

- **Type:** improvement | **Source:** manager
- **Reasoning:** Docs-only Lite: seed-included focus + empty-url Instant Answer contracts; guard.ts duty documented; stale CI line removed; roadmap prioritized with role owners; browser actions deferred (Browsh HTTP limit).

### Task 12: Release v2.4.0

- **Type:** feature | **Source:** manager
- **Reasoning:** Minor bump (behavior-affecting fixes + docs); milestone v2.4.0 opened; manager-pushed commit+tag; CI main + tag runs green (~11-12 min); :2.4.0 + :latest published, pulled, 5-tool smoke passed.
