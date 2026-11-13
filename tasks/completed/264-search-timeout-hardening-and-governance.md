# Task 264: search-timeout-hardening-and-governance

**File:** `tasks/completed/264-search-timeout-hardening-and-governance.md`
**Source:** manager
**Type:** feature
**Status:** closed
**Finished:** 2026-11-13T18:39:58Z
**Submitted:** 2026-11-13T18:36:32Z
**Supersedes:** [262, 263]
**Meta:** true
**Created:** 2026-11-13 18:33 UTC
**Bundled:** 2 tasks

## Supersedes

This META supersedes 2 source task(s). Each one is archived to `tasks/archive/` with a `**Superseded-By:** 264-search-timeout-hardening-and-governance` marker and stays reachable via `git log --oneline --follow -- tasks/archive/<id>-*.md`:

- `262` — Search timeout hardening for parallel multi-step searches
- `263` — Governance audit and remediation of AGENTS.md, conventions, and living folder docs

Execution is all-or-nothing: every line of `## Bundled Checklist (All-or-Nothing)` must pass, otherwise the whole META is `QA_REJECTED` and returns to `in-progress`. A partial close is forbidden.

## Goal

Unified execution of 2 related small tasks as a single META task to eliminate sequential overhead. This META bundles tasks [262, 263] — "search-timeout-hardening-and-governance" — into one branch, one diff, and one QA gate (all-or-nothing). Every requirement below is preserved **verbatim** from its source task; no summarization or omission is allowed.

> ⚠️ **Guardrail Warning:** Combined source size is 3773 LOC (> 400). Unified META diff may be large and hard to review. Consider splitting into two METAs.

**Source IDs:** [262, 263]
**Next ID:** 264 (discovered via `find tasks -name "*.md" | sort -n | tail -1 +1`)
**Archive Policy:** Source files will be moved to `tasks/archive/` with `superseded-by: 264-search-timeout-hardening-and-governance` and remain reachable via `git log --follow` (never purged until META is completed).

## Manager's Notes

**Bundle Decision (2026-08-21):** Manager requested fully automatic bundling with archive (not purge). This META was generated deterministically by the `bundle_tasks` MCP tool to execute 2 small related tasks together and speed up turnaround.

**Traceability:**
- Supersedes [262, 263] — see per-source verbatim blocks below
- Archive: each source moved via `git mv` to `tasks/archive/` with `**Superseded-By:** 264-search-timeout-hardening-and-governance` header + superseded footer
- Rollback: `git mv tasks/archive/<id>-*.md tasks/backlog/` + delete META file

**Guardrails Applied:**
- Cap 6 per bundle — this bundle has 2 (✅ within cap)
- Verbatim preservation — every source Goal/AC/TODO/Risk copied verbatim below (SHA comparison available in bundler dry-run)
- Diff-size check — combined 3773 LOC (⚠️ exceeds 400 — consider split)

## Source Bundles (Verbatim Preservation)

The following blocks are **verbatim copies** of each source task's critical sections. They are the source of truth; the checklist that follows is derived from them. Do not edit them manually — they were extracted by the bundler to guarantee zero omission.

### Source Task 262: Search timeout hardening for parallel multi-step searches

**Original File:** `/home/mohammad/Develop/Projects/blowsh-mcp/tasks/qa/262-search-timeout-hardening.md` → `tasks/archive/262-search-timeout-hardening.md` (after bundling)

**Title:** Search timeout hardening for parallel multi-step searches

#### Goal (verbatim)

Make `search_web` reliable and fast for multi-step parallel searches by bounding the Browsh render mutex queue wait, raising the per-render timeout, skipping engines already known to be robot-blocked, and giving the search a default deadline so it always ends in results or an honest `deadline.hit` instead of an unbounded hang.

#### Manager's Notes (verbatim)

Raw request (typo-corrected): "our project always fails and timeout in running multi step parallel searches, increase timeouts."

Approved plan:

- **D1** Bound the mutex queue wait and make it abortable. `acquire()` takes the request's `AbortSignal` plus a new `BROWSH_QUEUE_TIMEOUT_MS` (default 240s); a queued render that is cancelled or waits too long fails with an honest error instead of hanging. `release()` skips cancelled waiters so the mutex accounting stays correct.
- **D2** Raise the per-render timeout: `BROWSH_REQUEST_TIMEOUT_MS` default 30s -> 90s.
- **D3** Skip engines already known to be blocked. A 10-minute per-engine breaker records an engine whose page matched `isBlockedPage()`, so blocked Google/Startpage tiers stop costing renders. The breaker may only skip an engine while another candidate is untried, so it can never turn a working search into an empty one.
- **D4** Give `search_web` a default deadline. New `SEARCH_DEADLINE_MS` (default 180s) so a search always ends in results or an honest `deadline.hit`, never an unbounded hang. The `deadline_ms` ceiling rises 600s -> 900s in the zod schemas and tool descriptions.
- **D5** Keep enrichment inside the budget by passing the remaining deadline into each enrichment fetch.
- **D6** Docs and tests: `.env.example`, `src/tools/README.md`, `src/tools/DECISIONS.md`, `CHANGELOG.md`, `docs/data_model.md`, and a regression test in `tests/` using the existing `tsx` harness.

Out of scope: the engine set, the consensus merge, the relevance guard, the SSRF guard, and the API shapes.

### Root cause (as diagnosed during the context phase)

`browshManager` runs every render through one FIFO mutex (`src/browshManager.ts:240`). The per-render axios timeout starts only *after* the mutex is granted (`src/browshManager.ts:272-312`), so queue wait is unbounded and invisible to the caller.

`search_web` looks parallel but is not: Tier 1 Google is 1 render, Tier 2 Startpage is 1 render, and the Tier 3 consensus pool fires 4 renders through `Promise.allSettled` that all queue on the same mutex (`src/tools/searchWeb.ts:725`, `:743`, `:764`). That is up to 6 serialized renders per query. With `query_variants` (base + 2) it is up to 18 renders on one mutex, up to 540s at the previous 30s render cap.

Two aggravating facts: Google and Startpage are usually robot-blocked from datacenter IPs, so two renders per query yield nothing; and `search_web` has no outer timeout unless `deadline_ms` is passed (`src/tools/searchWeb.ts:919`), so the client gives up while the server is still rendering.

#### Acceptance Criteria (verbatim)

- [x] A render queued behind the Browsh mutex for longer than `BROWSH_QUEUE_TIMEOUT_MS` fails with an honest `FetchError` naming the queue wait, instead of hanging silently.
- [x] A queued render whose `AbortSignal` fires while it waits for the mutex is cancelled and releases the mutex without deadlocking the next waiter.
- [x] `BROWSH_REQUEST_TIMEOUT_MS` defaults to 90000 ms. (Raised again to 180000 in the ladder pass, with the queue, search, enrichment, and startup budgets moved together so the arithmetic stays coherent; see Verification 5.)
- [x] An engine whose rendered page matched `isBlockedPage()` is skipped on the next search within the breaker TTL, and the breaker never skips the last untried engine.
- [x] `search_web` without an explicit `deadline_ms` still terminates with results or an honest `deadline.hit` error, bounded by `SEARCH_DEADLINE_MS` (default 180000 ms).
- [x] The `deadline_ms` parameter accepts values up to 900000 ms in the zod schemas and the tool descriptions.
- [x] The enrichment phase passes the remaining deadline into each enrichment fetch instead of letting each fetch take a fresh full render window.
- [x] `npm run build` exits 0 under strict tsc, and every `tests/*.ts` suite exits 0.

#### Local TODOs (verbatim)

- [x] Initial codebase exploration
- [x] Diagnose the parallel-search timeout chain (mutex, tier chain, missing outer deadline)
- [x] D1: bounded + abortable mutex queue wait in `src/browshManager.ts`
- [x] D2: raise `BROWSH_REQUEST_TIMEOUT_MS` default to 90s
- [x] D3: per-engine blocked breaker in `src/tools/searchWeb.ts`
- [x] D4: default `SEARCH_DEADLINE_MS` + raise the `deadline_ms` ceiling to 900s
- [x] D5: clamp enrichment to the remaining deadline
- [x] D6: `.env.example`, `src/tools/README.md`, `src/tools/DECISIONS.md`, `CHANGELOG.md`, `docs/data_model.md`
- [x] Regression test in `tests/` (tsx harness, no network)
- [x] Verify functionality (`npm run build` + the new and existing `tests/*.ts` suites)

#### Risk & Rollback (verbatim)

- **Risk:** The default search deadline changes behaviour for callers that previously ran unbounded — a search that would have hung now fails with `deadline.hit` at 180s. This is the intended fix (an honest error instead of a client-side hang), but it is a visible behaviour change for slow hosts.
- **Risk:** The blocked-engine breaker could skip a working engine if a block page is misdetected. Mitigated by a short TTL (10 minutes) and the rule that the breaker may never skip the last untried engine.
- **Risk:** Raising the per-render timeout to 90s lengthens the worst case of a single render failure. Mitigated by D1 (bounded queue wait) and D4 (overall search deadline), which cap total wall clock.
- **Rollback plan:** Each change is a small, independent edit. Revert the `BROWSH_REQUEST_TIMEOUT_MS` and `SEARCH_DEADLINE_MS` defaults in `.env.example`, remove the breaker block in `src/tools/searchWeb.ts`, and restore the previous `acquire()`/`release()` pair in `src/browshManager.ts`. The new env knobs are additive, so removing their use restores the previous behaviour exactly.

#### Source Context (verbatim)

### Variant C: Manager (`**Source:** manager`)

#### Verification Evidence (verbatim)

### Verification 1 — new regression suite (RTK first run)

- **Test command:** `rtk test npx tsx tests/search-timeout-hardening-tests.ts`
- **Expected result:** every check PASS and exit 0.
- **Actual result:** `all 31 checks passed`, plus `RenderQueue` PASS lines for the free slot, FIFO hand-off, abort-skips-dead-waiter, no-deadlock, and queue-timeout cases; the search-budget and breaker groups also fully PASS.
- **Exit code:** 0

Raw rerun (same suite, full output, no wrapper):

```
$ npx tsx tests/search-timeout-hardening-tests.ts
[RenderQueue — bounded and abortable wait]
free slot is granted immediately: PASS
slot frees after release: PASS
second waiter is queued while the slot is busy: PASS
queued waiter is granted on release: PASS
slot stays busy across the hand-off: PASS
slot frees once the last waiter releases: PASS
two waiters queue behind a busy slot: PASS
aborted waiter reports aborted, not granted: PASS
aborted waiter is skipped and the live waiter gets the slot: PASS
aborted waiter leaves no residue in the queue: PASS
no deadlock: slot frees after the aborted waiter is skipped: PASS
queue budget expiry reports queue-timeout, not granted: PASS
slot frees after a queue-timeout waiter: PASS
already-aborted signal does not take the slot: PASS

[search_web — default budget]
default budget is 180000 when SEARCH_DEADLINE_MS is unset: PASS
explicit budget wins over the default: PASS
zero budget falls back to the default: PASS
negative budget falls back to the default: PASS
budget clamps up to the 500ms floor: PASS
budget clamps down to the 900000ms ceiling: PASS
ceiling constant is 900000: PASS
default budget stays inside the allowed band: PASS

[search_web — blocked-engine breaker]
unblocked engine is never skipped: PASS
breaker is armed when nothing is remembered: PASS
blocked engine is skipped while armed: PASS
other engines are still tried: PASS
breaker stays armed while another candidate is live: PASS
with every candidate blocked the breaker is disarmed: PASS
disarmed breaker never skips, so the search is never emptied: PASS
reset clears the breaker: PASS
reset re-arms the breaker: PASS

all 31 checks passed
```
Exit code: 0

### Verification 2 — TypeScript build (RTK first run)

- **Test command:** `rtk test npm run build`
- **Expected result:** strict tsc compiles with no errors.
- **Actual result:** `> tsc` with no diagnostics.
- **Exit code:** 0

### Verification 3 — full existing suite (regression)

Command run per suite; all nine exit 0.

```
tests/empty-extraction-guard-tests.ts            exit=0   Overall: ALL PASS
tests/guard-detector-tests.ts                    exit=0   All guard-detector tests passed.
tests/multilingual-relevance-guard-regression.ts exit=0   17 checks passed
tests/qa-boundary-tests.ts                       exit=0   Overall: ALL PASS
tests/search-engine-parser-tests.ts              exit=0   11 checks passed
tests/search-parser-hardening-regression.ts      exit=0   9 checks passed
tests/search-timeout-hardening-tests.ts          exit=0   31 checks passed
tests/task10-stress-fixes.ts                     exit=0   22 checks passed
tests/verify-donsetch-parity.ts                  exit=0   Summary: 26 pass, 0 fail of 26
```

### Verification 4 — runtime honesty probe (no browser on host)

A throwaway probe called `browshManager.fetchDom` with no browser running and with a pre-aborted signal. Both failed fast with an honest message instead of hanging:

```
fetchDom with no browser: threw after 6ms — Browsh not running
fetchDom with pre-aborted signal: threw after 0ms — Render cancelled: the request was aborted before it could acquire the browser
```

> Note: the probe process itself stayed alive afterwards because `resetIdleTimer()` installs an un-unref'd 600 s idle timer. That timer is pre-existing (`git show HEAD:src/browshManager.ts` shows it unchanged) and unrelated to this task; it is harmless for the long-lived MCP server, which never exits.

### Verification 5 — timeout ladder (second pass, RTK first run)

- **Test command:** `rtk test npx tsx tests/search-timeout-hardening-tests.ts`
- **Expected result:** all checks PASS including the new ladder invariant group.
- **Actual result:** `all 42 checks passed`, with the ladder group reporting `search budget (900000) covers queue + render (780000): PASS`, `queue budget (600000) funds two renders (360000): PASS`, `enrich budget (180000) funds one render (180000): PASS`.
- **Exit code:** 0

Negative control — the guard must fail on a bad ladder, not just pass on a good one:

```
$ SEARCH_DEADLINE_MS=300000 npx tsx tests/search-timeout-hardening-tests.ts
search budget (300000) covers queue + render (780000): FAIL — 300000 < 780000
```
Exit code: 1

Build and full regression after the second pass:

```
rtk test npm run build                                  exit=0
all 9 tests/*.ts suites                                 exit=0
```

### Strict Tooling Gate

- **Repo root:** `/home/mohammad/Develop/Projects/blowsh-mcp`
- **Marker scan list:** `build.gradle.kts`, `pyproject.toml`, `package.json`, `next.config.*`, `src/ports/`, `apps/expo`, `vite.config.*`, `nuxt.config.*`, `nest-cli.json`, `prisma/schema.prisma`
- **Matched skills:** `node-hexagonal-api` (Node + TypeScript). The repo is a flat `src/` MCP server, not a ports-and-adapters layout, so the skill is applied for TS discipline and gate shape only, and its `dependency-cruiser`/`vitest`/`knip` gates are **not** present in this repo — this project's own gatekeeper is `tsc` (documented in `AGENTS.md`: "Lint: none configured; strict tsc is the gatekeeper").
- **Gate order actually run (fail-fast, all green):** `npm run build` (`tsc`) → per-suite `tsx` runs. No linter, type-linter, or coverage tool exists in this repo, so no such step was silently skipped.
- **Reason phrase:** matched skill applied for discipline; absent tooling recorded rather than invented.

#### Decision Log (verbatim)

**[2026-11-13] [D1] [EXECUTOR-DETECTED]:** The consensus pool keeps all four engines; the fix targets the serialized chain, not the merge.

- **Rationale:** The obvious latency fix — abort the pool once one engine returns results — would collapse the 4-engine consensus into winner-takes-all, contradicting the documented contract in `DESIGN.md`, `docs/data_model.md`, and `src/tools/README.md` ("merged by consensus (cross-engine agreement) rather than winner-takes-all"). Consensus ranking is a documented design decision, so it stays.
- **Alternatives considered:** (a) First-success abort of the pool — rejected, it silently degrades the documented ranking contract. (b) Reducing the pool to two engines — rejected, same contract violation.
- **Impact:** Latency is recovered from the wasted blocked-engine renders (D3) and from the bounded wait (D1/D4) instead of from dropping engines.

**[2026-11-13] [D2] [EXECUTOR-DETECTED]:** `search_web` gains a default deadline instead of remaining unbounded.

- **Rationale:** The tool already advertises "an honest deadline error, never a silent hang", but the deadline was opt-in, so the default path contradicted the contract. A default deadline makes the advertised behaviour true for every call.
- **Alternatives considered:** (a) Leaving the deadline opt-in and only bounding the queue wait — rejected, the overall call could still run far past any client timeout. (b) Enforcing the deadline only in the MCP server layer — rejected, the tool function would still hang when called directly.
- **Impact:** A search that exceeds `SEARCH_DEADLINE_MS` fails with `deadline.hit` after attempting the cheap HTTP fallback. `deadline_ms` still overrides the default.

---

### Source Task 263: Governance audit and remediation of AGENTS.md, conventions, and living folder docs

**Original File:** `/home/mohammad/Develop/Projects/blowsh-mcp/tasks/qa/263-governance-audit.md` → `tasks/archive/263-governance-audit.md` (after bundling)

**Title:** Governance audit and remediation of AGENTS.md, conventions, and living folder docs

#### Goal (verbatim)

Run the `governance` skill in audit mode against this project: evaluate `AGENTS.md` and `docs/conventions.md` against the Target Audit Criteria, patch every violation found, and bring the living folder docs into compliance (sibling `README.md` + `DECISIONS.md` per component, one-line code pointers).

#### Manager's Notes (verbatim)

The Manager asked to "apply $governance to our project". Audit mode was selected because `AGENTS.md`, `docs/conventions.md`, `docs/architecture.md`, and `docs/data_model.md` all already exist.

### Audit findings (read-only pass, before any patch)

**Real violations (F1–F3), all fixed:**

- **F1 — Goal plugin runtime state not gitignored.** `.opencode/goals/` existed with live per-session goal and evidence files (`ses_*.json`, `ses_*.evidence.json`) and was absent from `.gitignore`. `git check-ignore` confirmed it was not ignored. The Target Audit Criteria require goal plugin state to be gitignored as runtime scratch.
- **F2 — `src/DECISIONS.md` missing.** The Living Folder Docs Standard requires every component/slice directory to hold both a `README.md` and a `DECISIONS.md`. `src/tools/` had both; `src/` had only `README.md`.
- **F3 — 13 of 14 source files lacked the `// Sibling Docs:` pointer.** Only `src/tools/fetchWeb.ts` carried the one-line code pointer. The standard requires every primary source file in a component directory to carry it.

**Wording defects (F4–F5), fixed:**

- **F4 — meta-language in two guardrails.** `Complex Debugging` and `Bilingual Prompt Refactoring` were written as "Agents MUST be instructed not to…" — instruction about the agent rather than instruction to the agent. Rewritten as direct directives.

**Verified compliant, no action taken:**

- `docs/conventions.md` contains all required sections: Universal DateTime Standard, SOLID, Universal Financial Ledger Standard, Defensive Shell Protocol, Task-Number Reference Discipline, Edit Tool Discipline, Living Folder Docs Standard.
- `AGENTS.md` contains the Mandatory First-Read Rule, Core File Locations (all 5 Kanban lanes), Decentralized Task Management, No Monolithic State, Zero-Autonomous-Commit with the `git mv` exception, Mandatory End-of-Task Sequence (with `custom_context_qa_transition`), Explicit Staging Contract (F5), Parallel Index Isolation, Edit Tool Discipline, Gatekeeper Validation, Context Bootstrapping, Buffer Isolation, MCP Report Generation, UI/UX Enforcement, DSP, Financial Ledger, Project Skills table.
- Deprecated-section purge: no `## Manager Decisions`, `## Admin Decision`, `Manager Decision`, or `Admin Decision` anywhere in `AGENTS.md`, `docs/`, or active task files. Clean.
- Lite Mode purge: no `<lite_mode_protocol>`, `Lite Mode`, `lite_mode`, `[LITE]`, or `Lite-eligible` in `AGENTS.md`, `docs/`, `README.md`, or `src/`. Clean.
- `tasks/.sessions/` already gitignored (Brain session transcripts).
- `.opencode/skills/` holds no `SKILL.md`, so the Project Skills table correctly records `_none_` rather than a stale row.

### Absent-File Policy

`DESIGN.md`, `docs/architecture.md`, and `docs/data_model.md` all exist and were audited normally. Nothing was scaffolded.

#### Acceptance Criteria (verbatim)

- [x] `.opencode/goals/` is gitignored and `git check-ignore` confirms it.
- [x] `src/DECISIONS.md` exists with dated ADRs whose Context/Decision/Consequences/Rollback content is grounded in verified code, not invented.
- [x] Every `.ts` file in `src/` and `src/tools/` carries the `// Sibling Docs:` pointer naming its sibling `README.md` and `DECISIONS.md`.
- [x] No `AGENTS.md` guardrail uses meta-language ("Agents MUST be instructed…"); each is a direct directive.
- [x] No deprecated sections and no Lite Mode markers exist in any live file.
- [x] `npm run build` exits 0 and all 9 `tests/*.ts` suites exit 0.

#### Local TODOs (verbatim)

- [x] Load the `governance` skill and read `templates/audit.md`
- [x] Read `AGENTS.md` and `docs/conventions.md` before any modification (read-only-first)
- [x] Scan for deprecated sections (`Manager Decisions`, `Admin Decision`)
- [x] Scan for Lite Mode markers
- [x] Scan `.opencode/skills/*/SKILL.md` and verify the Project Skills table is current
- [x] Audit `.gitignore` for runtime state (goal plugin, Brain sessions)
- [x] F1: gitignore the goal plugin runtime state
- [x] F2: create `src/DECISIONS.md` from verified code facts
- [x] F3: add the `// Sibling Docs:` pointer to all 13 remaining source files
- [x] F4: rewrite the two meta-language guardrails as direct directives
- [x] Verify build and full test suite still green
- [x] Record the audit in `CHANGELOG.md`

#### Risk & Rollback (verbatim)

- **Risk:** Adding 13 one-line header comments touches every source file, so a bad merge could conflict across the tree. Low impact — the lines are additive and carry no logic.
- **Risk:** `src/DECISIONS.md` records architectural decisions; if any entry is wrong it misleads future agents. Mitigated by grounding every entry in a specific verified file and line rather than recollection.
- **Rollback plan:** The gitignore addition is one block; removing it restores the previous state. The header comments are 13 independent one-line insertions, each revertible alone. `src/DECISIONS.md` is a new file — deleting it restores the prior tree. The two `AGENTS.md` wording fixes are single-line edits.

#### Source Context (verbatim)

### Variant C: Manager (`**Source:** manager`)

#### Verification Evidence (verbatim)

### Build (RTK first run)

- **Test command:** `rtk test npm run build`
- **Expected result:** strict tsc compiles with no errors.
- **Actual result:** `> tsc` with no diagnostics.
- **Exit code:** 0

### Full test suite

- **Test command:** loop over `tests/*.ts` with `npx tsx`
- **Expected result:** all nine suites exit 0.
- **Actual result:** all nine exit 0.
- **Exit code:** 0

### Pointer coverage

```
$ for f in src/*.ts src/tools/*.ts; do head -1 "$f" | grep -q "Sibling Docs:" || echo "MISSING: $f"; done
ALL 14 files have the pointer

$ grep -l "Sibling Docs:" src/*.ts src/tools/*.ts | wc -l
14
```

### Gitignore verification

```
$ git check-ignore -v .opencode/goals/
.gitignore:92:.opencode/goals/	.opencode/goals/

$ git status --short | grep goals
(no output — no longer surfaced as untracked)
```

### Deprecated-section and Lite Mode scans

```
$ grep -rn "## Manager Decisions\|## Admin Decision\|Manager Decision\|Admin Decision" AGENTS.md docs/ tasks/backlog tasks/in-progress tasks/qa
(no matches)

$ grep -rni "lite_mode\|lite mode\|lite-eligible\|\[LITE\]" AGENTS.md docs/ README.md src/ .opencode/
(no matches)
```

#### Decision Log (verbatim)

**[2026-11-13] [D1] [EXECUTOR-DETECTED]:** `src/DECISIONS.md` entries are grounded in verified code, not reconstructed from memory.

- **Rationale:** An invented ADR is worse than no ADR, because a future agent treats it as authoritative. Each entry was written only after grepping the specific mechanism it describes (process-group teardown at `browshManager.ts:539-553`, the `HOME` redirect at `:360`, DNS resolution in `ssrf.ts:76`, the cache in `cache.ts`), so every claim is checkable.
- **Alternatives considered:** (a) A short stub `DECISIONS.md` pointing at `src/tools/DECISIONS.md` — rejected, it leaves the slice without its own record. (b) Copying the tool-level records up — rejected, they are tool concerns, not server-module concerns.
- **Impact:** The file adds seven records covering the queue, the queue-timer trap, the budget ladder, session health, the profile redirect, the SSRF guard, and the render cache.

**[2026-11-13] [D2] [EXECUTOR-DETECTED]:** The `Sibling Docs` pointer went into all 13 files rather than only the ones being edited.

- **Rationale:** The Living Folder Docs Standard is a per-directory invariant, not a per-file courtesy; a partial rollout leaves the tree inconsistent and the next audit fails again. The build confirmed the comments are inert.
- **Alternatives considered:** Adding pointers only to files touched by the current task — rejected, it defers the same work to a later audit.
- **Impact:** `grep -l "Sibling Docs:"` returns 14 of 14.

---


## Bundled Checklist (All-or-Nothing)

> **QA Gate (all-or-nothing):** Every line below maps to one source acceptance criterion. If ANY line fails QA, the entire META is `QA_REJECTED` and returns to `in-progress`. Do not partially close.

- [x] [262] A render queued behind the Browsh mutex for longer than `BROWSH_QUEUE_TIMEOUT_MS` fails with an honest `FetchError` naming the queue wait, instead of hanging silently.
- [x] [262] A queued render whose `AbortSignal` fires while it waits for the mutex is cancelled and releases the mutex without deadlocking the next waiter.
- [x] [262] `BROWSH_REQUEST_TIMEOUT_MS` defaults to 180000 ms (raised 30000 → 90000 → 180000 across two passes; the queue, search, enrichment, and startup budgets moved with it so the arithmetic stays coherent — see Verification 5).
- [x] [262] An engine whose rendered page matched `isBlockedPage()` is skipped on the next search within the breaker TTL, and the breaker never skips the last untried engine.
- [x] [262] `search_web` without an explicit `deadline_ms` still terminates with results or an honest `deadline.hit` error, bounded by `SEARCH_DEADLINE_MS` (default 900000 ms).
- [x] [262] The `deadline_ms` parameter accepts values up to 1800000 ms in the zod schemas and the tool descriptions.
- [x] [262] The enrichment phase passes the remaining deadline into each enrichment fetch instead of letting each fetch take a fresh full render window.
- [x] [262] `npm run build` exits 0 under strict tsc, and every `tests/*.ts` suite exits 0.
- [x] [263] `.opencode/goals/` is gitignored and `git check-ignore` confirms it.
- [x] [263] `src/DECISIONS.md` exists with dated ADRs whose Context/Decision/Consequences/Rollback content is grounded in verified code, not invented.
- [x] [263] Every `.ts` file in `src/` and `src/tools/` carries the `// Sibling Docs:` pointer naming its sibling `README.md` and `DECISIONS.md`.
- [x] [263] No `AGENTS.md` guardrail uses meta-language ("Agents MUST be instructed…"); each is a direct directive.
- [x] [263] No deprecated sections and no Lite Mode markers exist in any live file.
- [x] [263] `npm run build` exits 0 and all 9 `tests/*.ts` suites exit 0.
- [x] Traceability: All 2 source tasks are archived with superseded-by marker and reachable via `git log --follow`

## Local TODOs

- [x] Step 1: Validate META bundle — confirm all 2 source requirements are captured verbatim below
- [x] Step 2: Implement unified changes covering all bundled tasks (single diff, single branch)
- [x] [262] Initial codebase exploration
- [x] [262] Diagnose the parallel-search timeout chain (mutex, tier chain, missing outer deadline)
- [x] [262] D1: bounded + abortable mutex queue wait in `src/browshManager.ts`
- [x] [262] D2: raise `BROWSH_REQUEST_TIMEOUT_MS` default to 90s
- [x] [262] D3: per-engine blocked breaker in `src/tools/searchWeb.ts`
- [x] [262] D4: default `SEARCH_DEADLINE_MS` + raise the `deadline_ms` ceiling to 900s
- [x] [262] D5: clamp enrichment to the remaining deadline
- [x] [262] D6: `.env.example`, `src/tools/README.md`, `src/tools/DECISIONS.md`, `CHANGELOG.md`, `docs/data_model.md`
- [x] [262] Regression test in `tests/` (tsx harness, no network)
- [x] [262] Verify functionality (`npm run build` + the new and existing `tests/*.ts` suites)
- [x] [263] Load the `governance` skill and read `templates/audit.md`
- [x] [263] Read `AGENTS.md` and `docs/conventions.md` before any modification (read-only-first)
- [x] [263] Scan for deprecated sections (`Manager Decisions`, `Admin Decision`)
- [x] [263] Scan for Lite Mode markers
- [x] [263] Scan `.opencode/skills/*/SKILL.md` and verify the Project Skills table is current
- [x] [263] Audit `.gitignore` for runtime state (goal plugin, Brain sessions)
- [x] [263] F1: gitignore the goal plugin runtime state
- [x] [263] F2: create `src/DECISIONS.md` from verified code facts
- [x] [263] F3: add the `// Sibling Docs:` pointer to all 13 remaining source files
- [x] [263] F4: rewrite the two meta-language guardrails as direct directives
- [x] [263] Verify build and full test suite still green
- [x] [263] Record the audit in `CHANGELOG.md`
- [x] Step 25: Verify all bundled checklist items and run lint_task_file + verification-before-completion
- [x] Step 26: Update CHANGELOG.md and record Verification Evidence

## Acceptance Criteria

- [x] [262] A render queued behind the Browsh mutex for longer than `BROWSH_QUEUE_TIMEOUT_MS` fails with an honest `FetchError` naming the queue wait, instead of hanging silently.
- [x] [262] A queued render whose `AbortSignal` fires while it waits for the mutex is cancelled and releases the mutex without deadlocking the next waiter.
- [x] [262] `BROWSH_REQUEST_TIMEOUT_MS` defaults to 180000 ms (raised 30000 → 90000 → 180000 across two passes; the queue, search, enrichment, and startup budgets moved with it so the arithmetic stays coherent — see Verification 5).
- [x] [262] An engine whose rendered page matched `isBlockedPage()` is skipped on the next search within the breaker TTL, and the breaker never skips the last untried engine.
- [x] [262] `search_web` without an explicit `deadline_ms` still terminates with results or an honest `deadline.hit` error, bounded by `SEARCH_DEADLINE_MS` (default 900000 ms).
- [x] [262] The `deadline_ms` parameter accepts values up to 1800000 ms in the zod schemas and the tool descriptions.
- [x] [262] The enrichment phase passes the remaining deadline into each enrichment fetch instead of letting each fetch take a fresh full render window.
- [x] [262] `npm run build` exits 0 under strict tsc, and every `tests/*.ts` suite exits 0.
- [x] [263] `.opencode/goals/` is gitignored and `git check-ignore` confirms it.
- [x] [263] `src/DECISIONS.md` exists with dated ADRs whose Context/Decision/Consequences/Rollback content is grounded in verified code, not invented.
- [x] [263] Every `.ts` file in `src/` and `src/tools/` carries the `// Sibling Docs:` pointer naming its sibling `README.md` and `DECISIONS.md`.
- [x] [263] No `AGENTS.md` guardrail uses meta-language ("Agents MUST be instructed…"); each is a direct directive.
- [x] [263] No deprecated sections and no Lite Mode markers exist in any live file.
- [x] [263] `npm run build` exits 0 and all 9 `tests/*.ts` suites exit 0.
- [x] Traceability: All 2 source tasks are archived with superseded-by marker and reachable via `git log --follow`

## Verification Evidence

- **Test command:** `rtk test npm run build`
- **Expected result:** strict tsc compiles with no errors.
- **Actual result:** `> tsc` with no diagnostics.
- **Exit code:** 0

- **Test command:** loop over `tests/*.ts` with `npx tsx`
- **Expected result:** all nine suites exit 0.
- **Actual result:** all nine exit 0 (`empty-extraction-guard`, `guard-detector`, `multilingual-relevance-guard`, `qa-boundary`, `search-engine-parser`, `search-parser-hardening`, `search-timeout-hardening` (42 checks), `task10-stress-fixes`, `verify-donsetch-parity`).
- **Exit code:** 0

### Per-criterion evidence (bundled checklist)

| Item | Evidence |
| --- | --- |
| [262] queue wait bounded + honest error | `BROWSH_QUEUE_TIMEOUT_MS` in `browshManager.ts`; `RenderQueue.acquire` → `giveUp("queue-timeout")` → `FetchError` in `fetchRaw` |
| [262] abort releases without deadlock | `RenderQueue.release()` skips `aborted` waiters; test case C proves the live waiter gets the slot |
| [262] render timeout default | `DEFAULT_RENDER_TIMEOUT_MS = 180_000` (`browshManager.ts:77`) |
| [262] breaker never empties a search | `isBreakerArmed()` gate + `poolEngines` fallback to the full list (`searchWeb.ts`) |
| [262] default search deadline | `DEFAULT_SEARCH_DEADLINE_MS = intEnvOrDefault(..., 900_000)` (`searchWeb.ts:57`) |
| [262] deadline ceiling 1800000 | `MAX_SEARCH_DEADLINE_MS` (`searchWeb.ts:60`), `MAX_DEADLINE_MS` (`fetchWeb.ts:98`), 3 zod schemas |
| [262] enrichment clamped | `enrichEnd` = `min(budgetEnd, now + ENRICH_BUDGET_MS)`, remaining passed as `deadline_ms` |
| [263] goals gitignored | `git check-ignore -v .opencode/goals/` → `.gitignore:92` |
| [263] src/DECISIONS.md | 7 dated ADRs, each traced to a code mechanism |
| [263] Sibling Docs pointers | `grep -l "Sibling Docs:" src/*.ts src/tools/*.ts \| wc -l` → 14 |
| [263] no meta-language | `grep -c "Agents MUST be instructed" AGENTS.md` → 0 |
| [263] no deprecated/Lite Mode | scans return no matches |
| Traceability | both sources in `tasks/archive/` with `**Status:** superseded` + `**Superseded-By:**` |

### Review chain (completed before bundling)

- **262:** QA Engineer `QA_PASSED` → Code Reviewer `APPROVED_WITH_CHANGES` → fixes → `APPROVED`. Real defects found and fixed: the `NaN` env path (`SEARCH_DEADLINE_MS=abc` would abort every search in ~1 ms) and the `budgetTimer.unref()` self-contradiction.
- **263:** QA Engineer `QA_PASSED` → Code Reviewer `APPROVED`. Two doc-drift items and a CHANGELOG structure defect fixed.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded

## Risk & Rollback

- **Risk:** Checklist omission — mitigated by verbatim copy + SHA-length comparison of source AC vs bundled checklist; script fails if mismatch >0.
- **Risk:** Mega-diff >400 LOC unreviewable — warning emitted; Manager should split if >400.
- **Risk:** Accidental purge — mitigation: only `git mv` to archive, never `git rm`; purge blocked until META reaches `tasks/completed/`.
- **Rollback plan:** `git mv tasks/archive/<id>-*.md tasks/backlog/<id>-*.md` for each superseded [262, 263], remove Superseded-By footer, delete or archive `tasks/backlog/264-search-timeout-hardening-and-governance.md` as abandoned. No HQ code beyond bundler is affected.

---

## Execution Log & Reasoning

### Bundling (final step)

Tasks 262 and 263 were bundled into META **264** via `custom_context_bundle_tasks` (dry-run first, then real). Both sources were archived to `tasks/archive/` with `**Status:** superseded` and `**Superseded-By:** 264-search-timeout-hardening-and-governance`; history stays reachable through `git log --follow`. This also resolved the cumulative-diff problem: the two tasks previously shared one worktree and one diff, so each task file carried the other's hunks. META 264 has a single diff.

Corrections applied to the generated META after bundling:

- Stale figures carried over from the first pass were updated in the **live** checklist and acceptance criteria only (`BROWSH_REQUEST_TIMEOUT_MS` 90000 → 180000, `SEARCH_DEADLINE_MS` default 180000 → 900000, `deadline_ms` ceiling 900000 → 1800000). The `### Source Task` appendix and the verbatim `#### Local TODOs` blocks were left untouched — those are provenance, and rewriting them would falsify the record.
- All bundled checklist items, acceptance criteria, TODOs, and DoD boxes were checked against the recorded evidence.

Final state: META 264 in `tasks/qa/`, one diff, 31 files staged. Build and all 9 suites green. Both source tasks archived.

### Closure approval

**Manager approval (verbatim):** "approved for closure"

Verified immediately before closure: the task file was still in `tasks/qa/`, the log still recorded `QA_PASSED` for both sources followed by Code Reviewer `APPROVED`, and `lint_task_file` passed. Closure proceeds through `custom_context_commit_and_clean_task` as the only commit path.

### QA/review chain status — COMPLETE (both sources, before bundling)

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `9ed26a017e28496af87ddf661f962ac4b4854363`
<!-- END_GIT_DIFF -->
