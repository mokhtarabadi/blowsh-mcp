# Task 11: Blowsh docs and contract gaps (crawl focus, Instant Answer, architecture)

**File:** `tasks/completed/11-blowsh-docs-contract-gaps.md`
**Source:** manager
**Type:** improvement
**Status:** closed

## Seat Check (Lite)

Domains: docs/contracts only → Software Architect (contract trigger). No UI, no flaky/race, no schema migration triggers → single-seat valid, no planning turn needed.

## Goal

Close five docs/contract gaps found in the 2026-09-17 audit: crawl focus seed exclusion, entity Instant Answer empty-URL result, stale CI/CD line in architecture, undocumented guard module, and unprioritized roadmap section 9.

## Manager's Notes

All items observed live or via discovery 2026-09-17. Crawl full with focus returned CharBudget + resume token correctly but skipped the seed itself as "focus filtered (no match)". Entity-intent search prepends a synthetic Instant Answer with url "" that counts toward max_results. docs/architecture.md section 6 lists both prebuilt-registry distribution and a stale "CI/CD: none currently" line. src/guard.ts has no duty entry in docs/architecture.md (only ssrf.ts/cache.ts documented). Roadmap section 9 (handles, adapters, browser actions, backpressure, SSRF allowlist) has no owner or priority. Decide each: doc fix, behavior fix, or explicit wont-fix with rationale.

<!-- These sections are unconditional per lint contract — DO NOT move back inside variants -->

## Local TODOs

- [x] Decide + document: should a focus-filtered crawl always fetch the seed? → NO: keep-and-explain (A1)
- [x] Decide + document: Instant Answer empty-URL result — keep-and-explain (Brain WONT-FIX)
- [x] Fix stale CI/CD line in docs/architecture.md section 6
- [x] Document src/guard.ts duty vs ssrf.ts (extension, not duplicate)
- [x] Prioritize roadmap section 9 items (owner + order + explicit deferral)
- [x] Verify functionality (docs build/lint where applicable)

## Acceptance Criteria

- [x] Crawl focus/seed behavior defined in docs and observed live
- [x] Instant Answer empty-URL behavior defined (consumers not surprised)
- [x] Architecture section 6 contradiction removed
- [x] guard.ts documented in architecture
- [x] Roadmap section 9 has priority/order or explicit deferral note

## Verification Evidence

- **Test command:** rtk test npm run build
- **Expected result:** exit 0; docs consistent; lint_task_file passes on this file
- **Actual result:** PASS — `rtk test npm run build` (tsc strict) completed with no errors after review-fix (roadmap owners + changelog note); docs-only change, no test surface affected
- **Exit code:** 0 (review-fix re-verified 2026-09-18)

> Verification runner rule: `[exact command]` is the complete underlying test command. The first verification run MUST use the `rtk test` prefix; record the exact prefixed command above. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** Docs-only; near-zero runtime risk
- **Rollback plan:** Revert docs edits

---

## Execution Log & Reasoning

**[2026-09-17] [LITE] [EXECUTION-DETECTED]:** Docs-only task, no code or behavior change, no security/financial surface — full production line bypassed with justification logged here.

**[2026-09-17] [DECISION D1] [EXECUTION-DETECTED]:** D4 seed always fetched? NO — keep-and-explain.
- **Rationale:** Code (`crawlWeb.ts:625-630`) applies the content-level focus gate to every fetched page including the seed; always fetching the seed would change budget/char accounting and the `stop` semantics. Documenting current behavior is the safe contract fix.
- **Alternatives considered:** behavior change (seed exempt from focus filter).
- **Impact:** docs only; live behavior unchanged (audit already observed seed skip as `focus filtered (no match)`).

**[2026-09-17] [EXECUTION-DETECTED]:** Assumption A1: D5 already documented (`data_model.md` Instant Answer `url: ""`); added only the consumer MUST-accept note. Assumption A2: roadmap priority order is my proposal (security first, browser actions deferred) — Manager may reorder.

## Brain QA verdict (2026-09-18, same task_id)

**VERDICT: QA_PASSED.** No source files changed (docs+changelog only). D4 seed-gate and D5 empty-url claims match code. Contradiction removed. No tests needed for docs-only. Lite valid. Zero truncation this round.

**[2026-09-18] [REVIEW-FIX] [EXECUTION-DETECTED]:** Reviewer APPROVED_WITH_CHANGES (I1 medium): roadmap §9 lacked owners. Added stable role-based `Owner:` labels to all 5 items (Security and networking; MCP protocol and platform; Integrations; Browser runtime; Browser backend research). Priority order and browser-actions deferral preserved. CHANGELOG Unreleased entry extended (owners note). No source files changed; `docs/data_model.md` untouched per XML.

**[2026-09-18] [REVIEW-ACCEPT] [EXECUTION-DETECTED]:** Code Reviewer final acceptance — APPROVED + PO_REVIEW_PENDING. I1 resolved. No blocking issues, no further changes required. Awaiting Manager "Approved for closure".
- **[2026-09-18] [CLOSURE] [EXECUTION-DETECTED]:** Manager approval word received ("Approved for closure"). File moved tasks/qa/ → tasks/completed/, Status closed, File header synced. Closure via sanctioned MCP commit path.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `96d47359154f706a881420b3dfe18d7a6e4ff61d`
<!-- END_GIT_DIFF -->
