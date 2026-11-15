# Milestone 2 Summary

**Date:** 2026-11-15
**Tasks Compacted:** 10
**Range:** v2.6.0 release → v2.7.0 release prep (search quality, timeout hardening, governance, empty-extraction guards)

## Source Distribution

| Source | Count |
| ------ | ----- |
| manager | 10 |

## Architectural Changes

- v2.6.0 tiered keyless search: Google attempted first with robot-block detection and short-circuit, Startpage proxy second, 4-engine consensus pool (Brave, Mojeek, Bing, DDG) third.
- Search parser hardening: strict organic containers with snippet sibling plus deny-list, structural block signals win over stale containers, Google `/url?q=` rescue deny-listed, query-relevance guard drops zero-overlap garbage before merge.
- Multilingual relevance: Unicode-aware tokenizer (`\p{L}` plus numbers) for Persian/Arabic/Cyrillic, page-language paragraph preference in main-content extraction, mixed-language wrapper containers get no lang bonus, Hebrew/CJK and wrapper-mono locks.
- Version drift fix: package.json wins as single source of truth, AGENTS.md and architecture unified.
- Clock-convention scope: in-memory TTL and elapsed-time `Date.now()` exempted, ban applies only to durable timestamps and test-sensitive scheduling.
- Folder docs: sibling `README.md` and `DECISIONS.md` for `src/` and `src/tools/`, task-number prose scrubbed from prompt-facing docs, `ENRICH_BUDGET_MS` documented.
- Empty-extraction guard: one guard at the render exit (`guardEmptyExtraction`, stable code `empty.extraction`) plus stitch, archive, and pdf paths, full-DOM retry for markdown, empty results never cached.
- Search timeout hardening: bounded render-queue wait (`BROWSH_QUEUE_TIMEOUT_MS`) with abort-signal support, waiter skip on give-up via exported `RenderQueue`, outer search budget (`SEARCH_DEADLINE_MS`) with in-flight abort, four-budget ladder invariant asserted in tests, `intEnvOrDefault` for malformed env, blocked-engine TTL skip, enrichment clamped to remaining budget.
- Governance audit: `.opencode/goals/` gitignored, `src/DECISIONS.md` added with seven ADRs, sibling-doc code pointers on all source files, direct-directive guardrails, new env knobs documented.
- Browsh abort-notice guard: `isRenderAbortNotice()` rejects the short HTTP-200 apology body for every output type, reuses `empty.extraction` code, survives Browsh version change.

## Files Modified

| File | Change |
| ---- | ------ |
| src/server.ts | Tool registration, version bump to 2.7.0 |
| src/searchWeb.ts | Tiered chain, parser hardening, relevance guard, queue and deadline budgets, blocked-engine TTL |
| src/extract.ts | Main-content language pick, empty-extraction guard, abort-notice rejection, full-DOM markdown retry |
| src/browshManager.ts | Render queue with bounded wait and waiter skip |
| src/tools/fetchWeb.ts | Wayback outcome classifier, deadline race, archive and stitch guards |
| src/cache.ts | TTL cache with clock-scope exemption |
| src/guard.ts | Bot-guard detection and per-host verdict cache |
| package.json | Version 2.7.0 |
| AGENTS.md | Current version 2.7.0, direct directives |
| docs/architecture.md | Version 2.7.0, ladder invariant, env knobs |
| docs/conventions.md | Clock-injection scope exemption |
| CHANGELOG.md | 2.6.0 through 2.7.0 entries |
| .env.example | Queue, deadline, blocked-engine TTL, enrich budget knobs |
| tests/* | Parser, multilingual, empty-extraction, and timeout-hardening suites |

## Criteria Met

| Task | Acceptance Criteria | Status |
| ---- | ------------------- | ------ |
| 15 | Release v2.6.0 cut with archive, bump, changelog, build | ✅ Met |
| 16 | Single source of truth for version, drift fixed | ✅ Met |
| 17 | Clock-convention gap resolved with scoped exemption | ✅ Met |
| 18 | Sibling docs added, prose scrubbed, env documented | ✅ Met |
| 19 | Irrelevant search results fixed via parser hardening | ✅ Met |
| 20 | Non-Latin relevance bypass and multi-lang extraction fixed | ✅ Met |
| 21 | Hebrew/CJK, wrapper, ranking, and typing follow-ups locked | ✅ Met |
| 261 | Silent empty success fails with `empty.extraction` | ✅ Met |
| 264 | Queue wait bounded, outer deadline enforced, governance clean | ✅ Met |
| 265 | Abort-notice body rejected as failed render | ✅ Met |

## Individual Task Summaries

### Task 15: Release v2.6.0

- **Type:** feature
- **Source:** manager
- **Reasoning:** Minor release for the Google-first tiered keyless search chain, with archive, bump, changelog, build, and push/tag handoff.

### Task 16: Fix version drift across AGENTS, architecture, and package

- **Type:** docs
- **Source:** manager
- **Reasoning:** Made package.json the winner and unified all version mentions.

### Task 17: Resolve Clock-injection vs Date.now convention gap

- **Type:** docs
- **Source:** manager
- **Reasoning:** Scoped the Clock ban to durable timestamps, kept direct `Date.now()` for TTL and elapsed-time measurement.

### Task 18: Living folder docs plus prompt-facing scrub

- **Type:** docs
- **Source:** manager
- **Reasoning:** Added colocated README and DECISIONS records, removed task numbers from prompt-facing prose.

### Task 19: Search parser hardening via SERP library study

- **Type:** research+implementation
- **Source:** manager
- **Reasoning:** Replaced brittle generic fallbacks with strict containers and deny-lists plus a query-relevance guard.

### Task 20: Search + fetch quality gaps (multilingual guard, markdown lang pick)

- **Type:** bugfix
- **Source:** manager
- **Reasoning:** Unicode tokenizer and language-aware main-content pick for non-Latin queries and multi-lang pages.

### Task 21: QA follow-up locks (Hebrew/CJK, wrapper-div, typing)

- **Type:** bugfix
- **Source:** manager
- **Reasoning:** Locked the task-20 follow-ups with extra fixtures and proper Cheerio typing.

### Task 261: `fetch_web` returns a silent empty success when the renderer extracts no text

- **Type:** bugfix
- **Source:** manager
- **Reasoning:** Central guard with stable `empty.extraction` code and no caching of empty bodies.

### Task 264: search-timeout-hardening-and-governance

- **Type:** feature
- **Source:** manager
- **Reasoning:** Bounded queue, outer deadline, coherent budget ladder, blocked-engine skip, enrichment clamp, plus governance audit fixes.

### Task 265: Browsh abort-notice body bypasses the empty-extraction guard

- **Type:** bugfix
- **Source:** manager
- **Reasoning:** Short-subject abort body rejected for every output type through the existing empty-extraction path.
