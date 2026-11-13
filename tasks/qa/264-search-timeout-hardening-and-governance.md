# Task 264: search-timeout-hardening-and-governance

**File:** `tasks/qa/264-search-timeout-hardening-and-governance.md`
**Source:** manager
**Type:** feature
**Status:** open
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
```diff
diff --git a/.env.example b/.env.example
index 6d58806..54e5052 100644
--- a/.env.example
+++ b/.env.example
@@ -27,13 +27,32 @@ PDF_MAX_BYTES=20971520
 # In-memory render cache TTL in milliseconds (default 300000 = 5 min)
 CACHE_TTL_MS=300000
 
-# Per-request timeout for Browsh renders in milliseconds (default 30000)
-BROWSH_REQUEST_TIMEOUT_MS=30000
-
-# Cold-start budget for the Browsh HTTP endpoint in milliseconds (default 60000).
+# Per-request timeout for Browsh renders in milliseconds (default 180000).
+# A render's wait behind the request mutex is bounded separately by
+# BROWSH_QUEUE_TIMEOUT_MS, so raising this cannot make a call hang.
+BROWSH_REQUEST_TIMEOUT_MS=180000
+
+# Queue-wait budget in ms before a render fails instead of waiting forever
+# (default 600000 = 10 min). The per-render timeout only starts once the mutex
+# is granted, so without this bound a queued render could hang silently.
+# Keep this >= 2x BROWSH_REQUEST_TIMEOUT_MS and <= SEARCH_DEADLINE_MS.
+BROWSH_QUEUE_TIMEOUT_MS=600000
+
+# Default wall-clock budget for one search_web call when the caller omits
+# deadline_ms (default 900000 = 15 min). On expiry the in-flight renders are
+# aborted and the call ends in an honest deadline.hit error, never a silent
+# hang. Keep this >= BROWSH_QUEUE_TIMEOUT_MS + BROWSH_REQUEST_TIMEOUT_MS.
+SEARCH_DEADLINE_MS=900000
+
+# How long a search engine that answered with a bot-block page is remembered
+# and skipped, in ms (default 600000 = 10 min). Prevents a dead tier from
+# costing a serialized render on every parallel search.
+SEARCH_BLOCKED_ENGINE_TTL_MS=600000
+
+# Cold-start budget for the Browsh HTTP endpoint in milliseconds (default 120000).
 # Measured cold start is ~31s on a warm profile, so a 30s window failed every
 # first fetch after a container start; raise this on slow hosts.
-BROWSH_STARTUP_TIMEOUT_MS=60000
+BROWSH_STARTUP_TIMEOUT_MS=120000
 
 # Browser session health
 # ----------------------
@@ -62,7 +81,9 @@ BROWSH_PREWARM=1
 GUARD_DETECT=1
 GUARD_CACHE_TTL_MS=3600000
 
-# Total wall-clock budget in ms for search_web enrich phase (default 45000)
-ENRICH_BUDGET_MS=45000
+# Total wall-clock budget in ms for the search_web enrich phase (default 180000).
+# Each enrichment is a full page render, so this must fund at least one
+# BROWSH_REQUEST_TIMEOUT_MS render; it is also clamped to the search budget.
+ENRICH_BUDGET_MS=180000
 
 # (Add custom MCP/AI integration secrets below as needed)
diff --git a/.gitignore b/.gitignore
index 2d61ff0..7094506 100644
--- a/.gitignore
+++ b/.gitignore
@@ -87,3 +87,10 @@ context-reports/
 
 # Brain session transcripts (per-project runtime state, never committed)
 tasks/.sessions/
+
+# Goal plugin runtime state (per-session goal + evidence sidecars, external scratch)
+.opencode/goals/
+.opencode/goal-state.json
+.opencode/goal-evidence.json
+.opencode/STOP_GOAL
+STOP_GOAL
diff --git a/.opencode/memory/architecture/living_folder_docs_required.md b/.opencode/memory/architecture/living_folder_docs_required.md
new file mode 100644
index 0000000..3b6cd2c
--- /dev/null
+++ b/.opencode/memory/architecture/living_folder_docs_required.md
@@ -0,0 +1,13 @@
+---
+tags: [governance, docs, living-folder]
+---
+
+# Living folder docs are mandatory in every component directory
+
+Every component or vertical-slice directory MUST hold both `README.md` and `DECISIONS.md`, and every primary source file in it MUST carry a one-line `// Sibling Docs: <dir>/README.md | Decisions: <dir>/DECISIONS.md` pointer at the top.
+
+Verified in blowsh-mcp: `src/` and `src/tools/` each hold both files, and all 14 `src/*.ts` + `src/tools/*.ts` files carry the pointer (audit 2026-11-13).
+
+`DECISIONS.md` entries MUST be grounded in verified code, never reconstructed from memory — an invented ADR is worse than no ADR, because a future agent treats it as authoritative.
+
+Supersedes: none.
\ No newline at end of file
diff --git a/.opencode/memory/index.md b/.opencode/memory/index.md
new file mode 100644
index 0000000..cb81be7
--- /dev/null
+++ b/.opencode/memory/index.md
@@ -0,0 +1,9 @@
+# Project Memory Index
+
+> Auto-generated by `mcp-memory-server`. Do not edit directly.
+
+| Namespace | Key | Summary | Tags |
+| :--- | :--- | :--- | :--- |
+| architecture | living_folder_docs_required | # Living folder docs are mandatory in every component directory | governance, docs, living-folder |
+| blowsh-mcp | config-quirks | Env var quirks (v2.1): |  |
+| blowsh-mcp | v211-bugfix-quirks | v2.1.1 bug-fix quirks (2026-08-03): |  |
diff --git a/AGENTS.md b/AGENTS.md
index 699b91d..3e43e1d 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -105,8 +105,8 @@ Scan `.opencode/skills/*/SKILL.md` on every audit and keep this table current 
 - **Buffer Isolation:** The shared validation phase MUST include a buffer-flush directive requiring Hands to treat every task as contextually independent, preventing cross-task context leakage.
 - **MCP Report Generation:** Agents MUST generate context reports (`custom_context_read_source_files`) and tree reports (`custom_context_create_tree_report` — "create a tree of the project") via the MCP server and hand the file path to the Manager instead of reading `context-reports/` files inline.
 - **UI/UX Enforcement:** Any UI/UX changes MUST enforce the guidelines defined in the project's `DESIGN.md`.
-- **Complex Debugging:** Agents MUST be instructed not to guess blindly on complex bugs, but instead utilize the `debug-instrumentation` skill.
-- **Bilingual Prompt Refactoring & Brainstorming Protocol:** Agents MUST be instructed not to execute raw, informal, or non-English prompts directly. The `prompt-refactor` skill must be loaded, or the Phase 1.5 Multi-Agent Brainstorming Protocol triggered, to translate and expand intent first. Standard XML task blocks are exempt.
+- **Complex Debugging:** Do not guess blindly on complex bugs, deadlocks, or silent timeouts. Load the `debug-instrumentation` skill to inject strategic logs and trace the runtime execution path.
+- **Bilingual Prompt Refactoring & Brainstorming Protocol:** Do not execute raw, informal, or non-English prompts directly. Load the `prompt-refactor` skill to translate and expand the intent first, or trigger the Phase 1.5 Multi-Agent Brainstorming Protocol for cross-disciplinary ambiguity. Standard XML task blocks are exempt.
 
 ## 🛑 CONTEXT BOOTSTRAPPING
 
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 748cb93..4303567 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -2,6 +2,22 @@
 
 ## [Unreleased]
 
+### Changed
+
+- Bundled the two in-flight tasks into one META (search timeout hardening + governance audit) so they close as a single unit with one diff and one all-or-nothing QA gate. The two source task files are archived to `tasks/archive/` with `**Status:** superseded` and a `**Superseded-By:**` marker, and stay reachable through `git log --follow`.
+- Governance audit of `AGENTS.md` and `docs/conventions.md` against the Target Audit Criteria. Fixed: `.opencode/goals/` (live per-session goal and evidence state) was not gitignored — it is now, alongside the legacy goal-state paths; `src/DECISIONS.md` was missing entirely, so the server-side slice had no decision record (added, seven ADRs grounded in the actual code: the bounded render queue, the queue-timer trap where `.unref()` made the timeout unreachable, the four-budget ladder invariant, session health through the mutex, the profile `HOME` redirect, the DNS-level SSRF guard, and the TTL render cache); 13 of 14 source files lacked the mandatory `// Sibling Docs:` code pointer (all now carry it, 14 of 14); two `AGENTS.md` guardrails were written as meta-language ("Agents MUST be instructed…") and are now direct directives. `docs/conventions.md` already held every required section, and no deprecated sections or Lite Mode markers exist anywhere in the live tree.
+- New env knobs documented in `.env.example` and `README.md`: `BROWSH_QUEUE_TIMEOUT_MS`, `SEARCH_DEADLINE_MS`, `SEARCH_BLOCKED_ENGINE_TTL_MS`, `ENRICH_BUDGET_MS`. `docs/architecture.md` records the serialized-slot cost of the tier chain and the ladder invariant.
+
+### Fixed
+
+- Parallel multi-step `search_web` calls failed or timed out: every render goes through one serialized browser slot, so a 3-query `query_variants` search could queue up to 18 renders, and the per-render timeout started only *after* the slot was granted — leaving the queue wait unbounded and invisible to the caller. The wait is now bounded by `BROWSH_QUEUE_TIMEOUT_MS` (default 600000 ms) and by the request's `AbortSignal`, so a queued render fails with an honest `FetchError` instead of hanging. A waiter that gives up is skipped by `release()`, so the slot is never handed to a settled promise. The queue lives in the exported `RenderQueue` class, covered by `tests/search-timeout-hardening-tests.ts` (42 checks, no browser, no network).
+- `search_web` had no outer deadline unless the caller passed `deadline_ms`, so the client gave up while the server was still rendering. Every search now runs under a budget — `deadline_ms` when given, otherwise `SEARCH_DEADLINE_MS` (default 900000 ms) — and on expiry the in-flight renders are aborted, so a timed-out search releases the browser slot instead of rendering on in the background. The `deadline_ms` ceiling rose 600000 → 1800000 ms in the schemas, the tool descriptions, `fetch_web`, and `docs/data_model.md`, so the runtime clamp no longer silently rejected a schema-valid value.
+- The four timeout budgets contradicted each other and are now one coherent ladder: `SEARCH_DEADLINE_MS` (900000) ≥ `BROWSH_QUEUE_TIMEOUT_MS` (600000) + `BROWSH_REQUEST_TIMEOUT_MS` (180000), and the queue funds two renders. Previously the 180 s search budget was shorter than the 240 s queue wait it contained, so the budget expired before the queue bound could ever matter. The invariant is asserted in `tests/search-timeout-hardening-tests.ts` rather than as four magic numbers, so raising one knob alone fails there with the arithmetic printed.
+- A malformed budget env var could abort every search instantly. `SEARCH_DEADLINE_MS=abc` produced `NaN`, which propagates through `Math.min`/`Math.max` and makes `setTimeout(fn, NaN)` fire in about 1 ms. Both `SEARCH_DEADLINE_MS` and `ENRICH_BUDGET_MS` now parse through `intEnvOrDefault`, which rejects non-finite values and falls back to the default.
+- Dead search tiers cost a render on every query: Google and Startpage are usually robot-blocked from datacenter IPs, so 2 of the up to 6 serialized renders per query returned nothing. An engine whose page matched the block detector is now remembered for `SEARCH_BLOCKED_ENGINE_TTL_MS` (default 600000 ms) and skipped on later searches. The breaker may only skip an engine while another candidate is untried, so it can never turn a working search into an empty one.
+- Enrichment could outlive its search: the phase used a fresh `ENRICH_BUDGET_MS` window and each `fetch_web` started a new full render budget. Both are now clamped to the remaining search budget, and `ENRICH_BUDGET_MS` rose 45000 → 180000 ms so it can fund one render.
+- `BROWSH_REQUEST_TIMEOUT_MS` default raised 30000 → 180000 ms, and `BROWSH_STARTUP_TIMEOUT_MS` 60000 → 120000 ms, so a merely slow page or cold start is no longer a failed render (the queue bound and search budget keep this from becoming a hang).
+
 ## [2.6.2] - 2026-11-11
 
 ### Fixed
diff --git a/README.md b/README.md
index 5f2f178..ef7500b 100644
--- a/README.md
+++ b/README.md
@@ -221,13 +221,16 @@ MCP_TRANSPORT=stdio
 BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr
 HTML2MARKDOWN_PATH=html2markdown
 CACHE_TTL_MS=300000
-BROWSH_REQUEST_TIMEOUT_MS=30000
+BROWSH_REQUEST_TIMEOUT_MS=180000
+BROWSH_QUEUE_TIMEOUT_MS=600000
+SEARCH_DEADLINE_MS=900000
 ALLOW_PRIVATE_URLS=false
 NODE_ENV=production
 ```
 - `BROWSH_FIREFOX_PATH` lets you customize the Firefox executable used by Browsh during headless/HTTP operation.
 - `HTML2MARKDOWN_PATH` lets you specify a custom path to the html2markdown binary (default: `html2markdown` in PATH).
-- `CACHE_TTL_MS`, `BROWSH_REQUEST_TIMEOUT_MS`, and `ALLOW_PRIVATE_URLS` tune the render cache, per-request timeout, and SSRF guard respectively.
+- `CACHE_TTL_MS`, `BROWSH_REQUEST_TIMEOUT_MS`, and `ALLOW_PRIVATE_URLS` tune the render cache, per-render timeout, and SSRF guard respectively.
+- `BROWSH_QUEUE_TIMEOUT_MS` bounds how long a render may wait behind the serialized browser slot, and `SEARCH_DEADLINE_MS` is the default budget for `search_web`. These form one ladder and must agree: `SEARCH_DEADLINE_MS ≥ BROWSH_QUEUE_TIMEOUT_MS + BROWSH_REQUEST_TIMEOUT_MS`, and `BROWSH_QUEUE_TIMEOUT_MS ≥ 2 × BROWSH_REQUEST_TIMEOUT_MS`. Raise them together for a slow host; a search always ends in results or an honest `deadline.hit`.
 - Browsh's HTTP port/host are NOT configurable.
 
 ---
@@ -253,7 +256,7 @@ This README is the user-facing entry point; agent-facing rules live in `AGENTS.m
 | Name             | Params                                                                                                                                                                                                                          | AI Use-case/Description                                                                                                                                                                                                                 |
 |------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
 | fetch_web        | `{ url, type: "plain"\|"html"\|"markdown"\|"pdf", selector?, max_chars?, wait_ms?, focus?, toc?: boolean, section?, must_contain?, archive?: "auto"\|"only"\|"off", stitch?: boolean, deadline_ms?: number, tier?: "auto"\|"1"\|"2", links?: boolean, media?: boolean, since_last?: boolean, offset?: number }` | Fetch one page post-JS-render as text/HTML/Markdown. `selector` (CSS) extracts only the matched element; `max_chars` caps output; `wait_ms` polls until JS settles. `focus` filters to BM25-relevant blocks (50-80% shorter); `toc` returns outline, `section` returns one heading's content; `must_contain` probe returns MATCH/NO-MATCH + excerpts; `archive` resurrects dead links via Wayback; `stitch` follows `rel=next` up to 6 parts; `deadline_ms` hard budget; `tier` auto/1/2; `links`/`media` toggles; `since_last` unchanged detection; `offset` resume. `type: pdf` downloads the PDF directly (20 MB max) and extracts text via pdftotext — `selector`/`wait_ms`/`max_chars` do not apply. |
-| search_web       | `{ query: string, max_results?: number, page?: number, enrich?: boolean, query_variants?: string[] (max2), intent?: "auto"\|"web"\|"code"\|"paper"\|"news"\|"entity", deadline_ms?: number }` | Search the web (DDG+Bing+Brave+Mojeek fused by consensus + intent verticals: GitHub/Wikipedia/arXiv/HN) and return `[{title, url, snippet, fetched_at}]`. `query_variants` searches alternate formulations in parallel (merged); `intent` selects verticals; `deadline_ms` caps call with honest deadline error (never hang); `page` 1–10; `enrich: true` replaces top-3 snippets with fetched markdown (45 s budget). `fetched_at` is UTC epoch ms. Feed URLs to fetch_web/extract_links. |
+| search_web       | `{ query: string, max_results?: number, page?: number, enrich?: boolean, query_variants?: string[] (max2), intent?: "auto"\|"web"\|"code"\|"paper"\|"news"\|"entity", deadline_ms?: number }` | Search the web (DDG+Bing+Brave+Mojeek fused by consensus + intent verticals: GitHub/Wikipedia/arXiv/HN) and return `[{title, url, snippet, fetched_at}]`. `query_variants` searches alternate formulations in parallel (merged); `intent` selects verticals; `deadline_ms` caps the call with an honest deadline error (never hang) and defaults to `SEARCH_DEADLINE_MS` (900 s) when omitted; `page` 1–10; `enrich: true` replaces top-3 snippets with fetched markdown (180 s budget). `fetched_at` is UTC epoch ms. Feed URLs to fetch_web/extract_links. |
 | crawl_web        | `{ url: string, mode?: "full"\|"map"\|"content", focus?, max_pages?: number, max_depth?: number, max_total_chars?: number, per_page_max?: number, include_paths?: string[], exclude_paths?: string[], same_host?: boolean, respect_robots?: boolean, deadline_s?: number, resume?: string, since_last?: boolean }` | Crawl a site from seed: two-phase sitemap discovery + focus-ranked frontier (BM25-lite) + Governor pacing (dwell variance + backoff). `mode` `full`=map+content, `map`=inventory only, `content`=BFS from seed. Budgets: `focus` ranks frontier, `max_pages`/`max_total_chars`/`deadline_s` cap run; `resume` token (30 min disk-backed) continues; `since_last` skips unchanged pages (<24h fingerprint). Returns `{seed, pages:[{url,title,kind,chars,quality}], map, queued, skipped, stop, elapsed_s, resume, crawl_delay}`. |
 | extract_links    | `{ url: string, limit?: number }`                                                                                                                                                                                             | Return all hyperlinks (`{text, url}`, absolute) present on a JS-rendered page, for navigation following without full DOM dumps.                                                  |
 | fetch_web_batch  | `{ urls: string[], type: "plain"\|"html"\|"markdown", selector?, max_chars?, wait_ms? }`                                                                                                                                 | Fetch up to 10 URLs in one call (cache-aware). Returns per-URL `{url, ok, content\|error}` — one failure never kills the batch.                                       |
@@ -275,7 +278,12 @@ Set these via `.env` (loaded automatically) or the environment:
 |-----------------------------|---------------|--------------------------------------------------------------------------|
 | `BROWSH_FIREFOX_PATH`       | `firefox`     | Firefox binary used by Browsh (e.g. `/usr/bin/firefox-esr`).             |
 | `HTML2MARKDOWN_PATH`        | `html2markdown` | Path to the html2markdown binary.                                      |
-| `BROWSH_REQUEST_TIMEOUT_MS` | `30000`       | Per-render request timeout (ms).                                          |
+| `BROWSH_REQUEST_TIMEOUT_MS` | `180000`      | Per-render request timeout (ms). The wait behind the render slot is bounded separately by `BROWSH_QUEUE_TIMEOUT_MS`, so this cannot become a hang. |
+| `BROWSH_QUEUE_TIMEOUT_MS`   | `600000`      | How long a render may wait behind the serialized slot before it fails honestly (ms). Keep ≥ 2× the render timeout. |
+| `SEARCH_DEADLINE_MS`        | `900000`      | Default wall-clock budget for one `search_web` call when `deadline_ms` is omitted (ms). Keep ≥ queue wait + render timeout. |
+| `BROWSH_STARTUP_TIMEOUT_MS` | `120000`      | Cold-start budget for the Browsh HTTP endpoint (ms); the measured cold start is ~31 s. |
+| `SEARCH_BLOCKED_ENGINE_TTL_MS` | `600000`   | How long an engine that answered with a bot-block page is remembered and skipped (10 min). |
+| `ENRICH_BUDGET_MS` | `180000` | Wall-clock budget for the `search_web` enrich phase (ms); each enrichment is a full render. |
 | `PDF_MAX_BYTES`             | `20971520`    | Max PDF file size in bytes for `fetch_web type: pdf`.                    |
 | `BROWSH_RECYCLE_REQUESTS`   | `100`         | Number of requests after which the browser process is recycled.          |
 | `BROWSH_IDLE_TIMEOUT_MS`    | `600000`      | Idle time in ms before the browser process is killed (10 min).           |
diff --git a/docs/architecture.md b/docs/architecture.md
index d34b8a4..0fdb4cf 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -64,8 +64,8 @@ blowsh-mcp/
 
 - Lazy-starts `browsh --http-server-mode` once; health-probes `http://127.0.0.1:4333/` for readiness.
 - `fetchRaw(url, mode)` GETs `127.0.0.1:4333/<url>` with `X-Browsh-Raw-Mode`; translates HTTP failures into `FetchError` with status code.
-- Port/host are fixed by Browsh (not configurable). Request timeout configurable via `BROWSH_REQUEST_TIMEOUT_MS`.
-- **Session health (v2.1):** a mutex serializes all renders. The process is recycled after `BROWSH_RECYCLE_REQUESTS` requests and killed after `BROWSH_IDLE_TIMEOUT_MS` idle (cache-mopped). Recycle/idle only fire in quiescent windows (`busy=false`, no waiters — `scheduleRecycle` defers via `setImmediate`) and tear down the whole process group (`detached: true` + negative-PID SIGTERM/SIGKILL) so orphaned Firefox child processes never hold the profile lock or block restarts. One-shot transport retry after a recycle.
+- Port/host are fixed by Browsh (not configurable). Request timeout configurable via `BROWSH_REQUEST_TIMEOUT_MS` (default 180000). A render's wait behind the mutex is bounded separately by `BROWSH_QUEUE_TIMEOUT_MS` (default 600000) and by the request's `AbortSignal`, so a queued render fails honestly instead of hanging; a waiter that gives up is skipped by `release()` so the slot is never handed to a settled promise. The queue lives in the exported `RenderQueue` class so this contract is testable without a browser. The four budgets form one ladder — `SEARCH_DEADLINE_MS` (900000) ≥ `BROWSH_QUEUE_TIMEOUT_MS` (600000) + `BROWSH_REQUEST_TIMEOUT_MS` (180000), and the queue funds two renders — asserted as an invariant in `tests/search-timeout-hardening-tests.ts` so raising one knob alone fails there instead of silently producing false timeouts.
+- **Session health (v2.1):** a mutex serializes all renders. Because the slot is single, a fan-out of N engines costs N serialized renders — the tier chain (Google → Startpage → 4-engine consensus pool) is therefore up to 6 renders per query, and `search_web` is bounded by one wall-clock budget (`deadline_ms` or `SEARCH_DEADLINE_MS`) whose expiry aborts the in-flight renders so a timed-out search stops holding the slot. Engines that answer with a bot-block page are remembered for `SEARCH_BLOCKED_ENGINE_TTL_MS` and skipped on later searches, while the breaker stays disarmed whenever every candidate is blocked. The process is recycled after `BROWSH_RECYCLE_REQUESTS` requests and killed after `BROWSH_IDLE_TIMEOUT_MS` idle (cache-mopped). Recycle/idle only fire in quiescent windows (`!isBusy && pending === 0` — `scheduleRecycle` defers via `setImmediate`) and tear down the whole process group (`detached: true` + negative-PID SIGTERM/SIGKILL) so orphaned Firefox child processes never hold the profile lock or block restarts. One-shot transport retry after a recycle.
 
 ### 3.3. Fetch Tools (`src/tools/`)
 
diff --git a/docs/data_model.md b/docs/data_model.md
index 3c3df44..f02cbfc 100644
--- a/docs/data_model.md
+++ b/docs/data_model.md
@@ -27,7 +27,7 @@ This document describes every MCP tool's input schema and output shape. The MCP
 | `must_contain` | string                | no       | probe: substring or `/regex/` |
 | `archive`      | `"auto"|"only"|"off"` | no       | Wayback resurrection |
 | `stitch`       | boolean               | no       | follow rel=next (markdown only) |
-| `deadline_ms`  | integer               | no       | 500..600_000 hard budget (deadline.hit) |
+| `deadline_ms`  | integer               | no       | 500..1_800_000 hard budget (deadline.hit) |
 | `tier`         | `"auto"|"1"|"2"`      | no       | auto / 1 HTTP-only / 2 browser-only |
 | `links`        | boolean               | no       | include [text](url) (default true, false saves 30%) |
 | `media`        | boolean               | no       | include ![alt](url)/<img> (default true) |
@@ -49,7 +49,7 @@ size-capped via `PDF_MAX_BYTES`, default 20 MB) and piped through `pdftotext`.
 - `must_contain="..."` → probe collapsed output: `MATCH` or `NO-MATCH` for pattern + ≤3 excerpts (`…context…`). Full fetch still happens; only output collapses (token saver ~60 vs 4k).
 - `archive="auto"` → on hard failure (404/paywall/timeout/network) serves Wayback snapshot labeled `> [archive snapshot from YYYY-MM-DD via Wayback Machine ...]`; when no snapshot exists the original error is rethrown unchanged (miss class logged to stderr: `no snapshot available | snapshot fetch failed | api-error`); `deadline.hit` expiry is NOT rescued (not a hard failure); `archive="only"` goes straight to Wayback (throws `archive.stale` if none).
 - `stitch=true` → follows `rel=next` up to 6 parts / 48k chars, returns stitched markdown with `*(part N)*` markers; same-host only.
-- `deadline_ms` → hard budget 500-600000ms; on expiry throws `deadline.hit: fetch timed out after ...` with stable code.
+- `deadline_ms` → hard budget 500-1800000ms; on expiry throws `deadline.hit: fetch timed out after ...` with stable code.
 - `tier="auto"|"1"|"2"` → `auto` (default, HTTP first → browser escalate), `1` HTTP-only, `2` browser-direct (skip sniff, always Browsh).
 - `links=false` → strips `[text](url)` → `text` (saves ~30% tokens); `media=false` strips `![alt](url)` and `<img>`.
 - `since_last=true` → fingerprint check (`blowsh-fetch-fingerprints.json`); unchanged → `unchanged since last fetch (fingerprint age)` one-liner; changed → `> [changed since last fetch — …]` banner.
@@ -67,9 +67,9 @@ size-capped via `PDF_MAX_BYTES`, default 20 MB) and piped through `pdftotext`.
 | `enrich`         | boolean | no      | default false; top-3 snippets replaced with fetched markdown |
 | `query_variants` | string[] | no     | max 2 alternate formulations, searched in parallel, merged |
 | `intent`         | `"auto"|"web"|"code"|"paper"|"news"|"entity"` | no | default auto (detects) — code adds GitHub, paper arXiv, news HN, entity Wikipedia |
-| `deadline_ms`    | integer | no      | 500..600_000, hard budget (honest deadline.hit error) |
+| `deadline_ms`    | integer | no      | 500..1_800_000, hard budget. Defaults to `SEARCH_DEADLINE_MS` (900000) when omitted; on expiry in-flight renders are aborted and the call throws `deadline.hit` (after trying cheap-fallback partials), never an unbounded hang |
 
-Notes: `page` synthesizes engine-specific offsets (Google/Startpage/Bing/Brave/Mojeek 10/page, DDG 20/page). Tiered fallback chain: Google attempted first with robot-block detection and short-circuits on clean results; Startpage proxy second; 4-engine consensus pool (Brave, Mojeek, Bing, DDG) third. Blocked renders resolve to empty so the chain moves on. Brave/Mojeek add coverage beyond DDG/Bing. When DDG's Instant Answer API returns an abstract, a synthetic result with `url: ""` and `title: "Instant Answer"` is prepended; it counts toward `max_results`. `enrich: true` is best-effort — a failed enrichment fetch keeps the original snippet. `query_variants` are searched in parallel (up to 3 queries including base) and merged with dedup (flat array, backwards compatible). `intent` selects verticals (code→GitHub, paper→arXiv, news→HN Algolia, entity→Wikipedia opensearch) fetched via direct axios (no Browsh). `deadline_ms` races the whole search; on expiry throws `deadline.hit`. Precedence rule: deadline expiry with zero data returns cheap-fallback partials when available, else throws `deadline.hit` — never a bare `[]`. An aborted engine under a fired global deadline is a deadline signal, not an ordinary empty set; a per-query `deadline.hit` propagates through `query_variants` instead of being swallowed. An empty organic result set with no deadline fired stays terminal success `[]`.
+Notes: `page` synthesizes engine-specific offsets (Google/Startpage/Bing/Brave/Mojeek 10/page, DDG 20/page). Tiered fallback chain: Google attempted first with robot-block detection and short-circuits on clean results; Startpage proxy second; 4-engine consensus pool (Brave, Mojeek, Bing, DDG) third. Blocked renders resolve to empty so the chain moves on. Every render goes through one serialized browser slot; a queued render is bounded by `BROWSH_QUEUE_TIMEOUT_MS` (default 600000) and by the request's abort signal, so a slow queue fails honestly instead of hanging. An engine whose page matched the block detector is remembered as blocked for `SEARCH_BLOCKED_ENGINE_TTL_MS` (default 600000) and skipped on later searches while another candidate remains untried. Brave/Mojeek add coverage beyond DDG/Bing. When DDG's Instant Answer API returns an abstract, a synthetic result with `url: ""` and `title: "Instant Answer"` is prepended; it counts toward `max_results`. `enrich: true` is best-effort — a failed enrichment fetch keeps the original snippet, and the phase is clamped to the remaining search budget. `query_variants` are searched in parallel (up to 3 queries including base) and merged with dedup (flat array, backwards compatible). `intent` selects verticals (code→GitHub, paper→arXiv, news→HN Algolia, entity→Wikipedia opensearch) fetched via direct axios (no Browsh). `deadline_ms` races the whole search; on expiry throws `deadline.hit`. Precedence rule: deadline expiry with zero data returns cheap-fallback partials when available, else throws `deadline.hit` — never a bare `[]`. An aborted engine under a fired global deadline is a deadline signal, not an ordinary empty set; a per-query `deadline.hit` propagates through `query_variants` instead of being swallowed. An empty organic result set with no deadline fired stays terminal success `[]`.
 
 **Output** `text` = pretty-printed JSON array:
 
@@ -156,7 +156,7 @@ Internal de-duplication applied; `javascript:`/`mailto:`/`tel:`/`data:`/`blob:`/
 | `selector`  | string           | no      |  |
 | `max_chars` | integer          | no      |  |
 | `wait_ms`   | integer          | no      |  |
-| `deadline_ms` | integer        | no      | 500..600_000 per-item budget; slow items fail fast with `ok:false` |
+| `deadline_ms` | integer        | no      | 500..1_800_000 per-item budget; slow items fail fast with `ok:false` |
 
 Batch supports only these fields — `focus/toc/section/must_contain/archive/stitch/tier/links/media/since_last/offset` stay single-fetch-only by contract. Render transport timeouts carry a transient-retry hint with URL attribution.
 
diff --git a/src/DECISIONS.md b/src/DECISIONS.md
new file mode 100644
index 0000000..5d7c746
--- /dev/null
+++ b/src/DECISIONS.md
@@ -0,0 +1,75 @@
+# src — Decisions
+
+Chronological Architectural Decision Records for the server-side modules. Newest last. Each entry: Context, Decision, Consequences, Rollback.
+
+Sibling of `src/README.md`. Tool-level records live in `src/tools/DECISIONS.md`.
+
+## 2026-11-13 — The render queue is bounded and abortable
+
+**Context.** Every render is serialized through one FIFO slot, and the per-render axios timeout started only *after* the slot was granted. A queued render therefore had no bound at all: a parallel search could wait behind other renders indefinitely, and the caller saw a hang rather than an error.
+
+**Decision.** Extract the mutex into an exported `RenderQueue` class. `acquire(signal)` returns `{ granted: true }` or `{ granted: false, reason }` where reason is `aborted` or `queue-timeout`. A waiter that gives up stays in the queue marked `aborted`, and `release()` skips it, so the slot is never handed to an already-settled promise. When acquisition fails, `fetchRaw` returns before taking the mutex, so nothing is released that was never held.
+
+**Consequences.** The wait contract is provable without a browser, which is why the class is exported and covered by `tests/search-timeout-hardening-tests.ts`. `BrowshManager` now delegates to `queue.isBusy` / `queue.pending`, so recycle and idle-kill decisions read the same accounting the waiters use.
+
+**Rollback.** Restore the previous `acquire()`/`release()` pair on `BrowshManager` and delete the `RenderQueue` export. The two call sites (`fetchRaw`, `scheduleRecycle`) are the only consumers.
+
+## 2026-11-13 — The queue timer must stay referenced
+
+**Context.** The first implementation of the queue budget called `.unref()` on the timeout handle, reasoning that a queued wait should not keep a finished process alive. The effect was the opposite of the intent: with nothing else holding the event loop, the timer never fired, so the queue-timeout branch was unreachable and a queued render would hang forever — the exact bug being fixed.
+
+**Decision.** The queue timer is deliberately NOT `unref()`ed. A queued wait must still fire its timeout even when nothing else holds the loop, or the queue budget is a no-op. The render request itself holds the loop while in flight, so keeping the handle referenced costs nothing.
+
+**Consequences.** A short-lived process that queues a render now stays alive until the budget expires and then fails honestly, instead of exiting silently. Caught by the `queue budget expiry` case in `tests/search-timeout-hardening-tests.ts`, which exits non-zero with an unsettled top-level await when the timer does not fire.
+
+**Rollback.** Not applicable — re-adding `.unref()` reintroduces the hang. Do not "clean this up".
+
+## 2026-11-13 — The four timeout budgets are one ladder
+
+**Context.** The per-render timeout, queue wait, search budget, and enrichment budget were edited as four independent knobs. At one point the search budget (180 s) was shorter than the queue wait it contained (240 s), so the budget expired before the queue bound could ever matter, and 180 s funded only two of the up-to-six renders one query needs. Raising the render timeout alone makes this strictly worse, because fewer renders fit in a fixed budget.
+
+**Decision.** Treat them as one ladder and assert the invariant rather than four numbers: `SEARCH_DEADLINE_MS ≥ BROWSH_QUEUE_TIMEOUT_MS + BROWSH_REQUEST_TIMEOUT_MS`, and the queue funds at least two renders (`queue ≥ 2 × render`). Defaults are exported constants (`DEFAULT_RENDER_TIMEOUT_MS`, `DEFAULT_QUEUE_TIMEOUT_MS`, `DEFAULT_STARTUP_TIMEOUT_MS`, `ENRICH_BUDGET_MS`) so the test reads what the code uses. The invariant lives in the `timeout ladder` group of `tests/search-timeout-hardening-tests.ts`.
+
+**Consequences.** A future edit that raises one knob alone fails the suite with the actual arithmetic printed, instead of silently producing false timeouts in production. Verified by running the suite with `SEARCH_DEADLINE_MS=300000`: it reports `search budget (300000) covers queue + render (780000): FAIL — 300000 < 780000` and exits 1.
+
+**Rollback.** Restore the previous numbers; the assertion reads the constants, so it follows automatically.
+
+## 2026-11-11 — Session health is enforced through the same mutex as fetches
+
+**Context.** Long sessions accumulate tabs in the persistent Firefox process, and a recycle issued mid-request would tear the browser down underneath an in-flight render.
+
+**Decision.** Recycle-after-N-requests and idle-kill are decided only in quiescent windows, re-checked immediately before acting, and deferred via `setImmediate` while the slot is busy or waiters remain. Teardown targets the whole process group (`detached: true` at spawn plus negative-PID `SIGTERM`, escalating to `SIGKILL`) so an orphaned Firefox child can never hold the profile lock and block the next restart. One transparent transport retry covers a request that races a recycle.
+
+**Consequences.** A recycle can never interrupt a live render, and a restart can never fight a stale profile lock. The cost is that a recycle may be deferred rather than immediate.
+
+**Rollback.** The deferral and group-teardown are one block in `scheduleRecycle` / `clearProcess`; reverting to a plain `proc.kill()` reintroduces orphaned Firefox processes.
+
+## 2026-11-11 — Persistent profile via a redirected HOME
+
+**Context.** Browsh 1.8.0 exposes no profile-directory flag, but the server needs cookies, history, and storage to survive restarts.
+
+**Decision.** Redirect the Browsh child's `HOME` to `BROWSH_PROFILE_DIR` so everything Firefox persists lands under one directory that a named volume or bind-mount can back. The directory is created with `mkdirSync(..., { recursive: true })` before spawn, and an existing directory is reused rather than wiped.
+
+**Consequences.** Profile persistence is a deployment concern (mount the volume), not a code path. A suspect profile can be quarantined aside by `quarantineProfileDir` when a boot-path failure looks like a corrupt profile.
+
+**Rollback.** Unset `BROWSH_PROFILE_DIR` to fall back to the default path; the redirect is the only mechanism.
+
+## 2026-11-11 — The SSRF guard resolves DNS before every request
+
+**Context.** A URL that resolves to a private or loopback address must never reach the network, but a hostname-level string check is trivially bypassed by a name that points at `127.0.0.1`.
+
+**Decision.** `assertSafeUrl` resolves the hostname with `dns.lookup(host, { all: true })` and rejects loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16), reserved, IPv4-mapped IPv6, and `localhost` at the *address* level. `ALLOW_PRIVATE_URLS=true` is the single documented kill-switch.
+
+**Consequences.** Every outbound URL pays one DNS resolution, and a hostname that resolves to a blocked address fails before any connection. The guard is a domain-level check, not a network-namespace guarantee.
+
+**Rollback.** Set `ALLOW_PRIVATE_URLS=true` to disable, or remove the `assertSafeUrl` call at a specific fetch path — never both.
+
+## 2026-11-11 — The render cache is in-memory and TTL-only
+
+**Context.** The server is stateless by default and must not require a datastore, but repeated calls for the same page should not re-render.
+
+**Decision.** `pageCache` is a `TtlCache` (default 5 min, `CACHE_TTL_MS`) keyed by URL plus the settle-relevant options. Truncation (`max_chars`) is applied at read time, never stored. Only content a guard already accepted is cached.
+
+**Consequences.** No persistence, no cross-process sharing, and a restart clears the cache. That is the intended trade for a single-container MCP server.
+
+**Rollback.** Set `CACHE_TTL_MS` low, or bypass the cache at a call site; the cache is the only consumer of `TtlCache` for pages.
diff --git a/src/README.md b/src/README.md
index 092fb95..c8017be 100644
--- a/src/README.md
+++ b/src/README.md
@@ -15,3 +15,5 @@ All runtime code for the blowsh-mcp MCP server (TypeScript 7 strict, NodeNext ES
 | `tools/` | Per-tool handlers, one file per MCP tool (see `tools/README.md`) |
 
 Rules: every outbound URL passes `assertSafeUrl`; every failure throws `FetchError`; strict tsc is the gatekeeper.
+
+Sibling docs: this file plus `DECISIONS.md` (dated ADRs for the server-side modules). Tool-level records live in `tools/README.md` and `tools/DECISIONS.md`. Every `.ts` file in this tree carries a one-line `// Sibling Docs:` pointer at the top.
diff --git a/src/browshManager.ts b/src/browshManager.ts
index f2008ce..9cdc918 100644
--- a/src/browshManager.ts
+++ b/src/browshManager.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 import { spawn, ChildProcess } from "child_process";
 import axios from "axios";
 import { FetchError } from "./errors.js";
@@ -67,6 +68,159 @@ function cleanPlainText(text: string): string {
   return lines.join("\n");
 }
 
+/**
+ * Default budgets for the render path (ms). Exported so the ladder can be
+ * asserted in one place: these three plus `SEARCH_DEADLINE_MS` must satisfy
+ * `searchDeadline >= queueWait + render`, or a render can be aborted while it
+ * was still legitimately queued.
+ */
+export const DEFAULT_RENDER_TIMEOUT_MS = 180_000;
+export const DEFAULT_QUEUE_TIMEOUT_MS = 600_000;
+export const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
+
+/**
+ * Resolve the render-path budgets the same way the constructor does, so a test
+ * can assert the ladder invariant on the values that actually run — not just on
+ * the defaults. An env combination that clamps each knob into its own band but
+ * breaks `search >= queue + render` must fail the assertion.
+ */
+export function resolveRenderTimeouts(env: NodeJS.ProcessEnv = process.env): {
+  render: number;
+  queue: number;
+  startup: number;
+} {
+  return {
+    render: clampIntEnv(env.BROWSH_REQUEST_TIMEOUT_MS, 10_000, 600_000, DEFAULT_RENDER_TIMEOUT_MS, "BROWSH_REQUEST_TIMEOUT_MS"),
+    queue: clampIntEnv(env.BROWSH_QUEUE_TIMEOUT_MS, 10_000, 1_200_000, DEFAULT_QUEUE_TIMEOUT_MS, "BROWSH_QUEUE_TIMEOUT_MS"),
+    startup: clampIntEnv(env.BROWSH_STARTUP_TIMEOUT_MS, 10_000, 600_000, DEFAULT_STARTUP_TIMEOUT_MS, "BROWSH_STARTUP_TIMEOUT_MS"),
+  };
+}
+
+/**
+ * One render queued behind the browser mutex.
+ *
+ * `aborted` marks a waiter that gave up while it was still queued (the
+ * caller's signal fired, or the queue budget expired). Such a waiter stays in
+ * the queue so the FIFO accounting stays intact, but `release()` must skip it:
+ * the mutex is handed to a live waiter, never to a dead one.
+ */
+interface Waiter {
+  resolve: (granted: boolean) => void;
+  aborted: boolean;
+}
+
+/** Outcome of a mutex acquisition attempt. */
+interface AcquireOutcome {
+  /** True when the mutex was granted and the caller may render. */
+  granted: boolean;
+  /** Why the wait ended without the mutex (absent when granted). */
+  reason?: "aborted" | "queue-timeout";
+}
+
+/**
+ * FIFO queue guarding the single Browsh render slot.
+ *
+ * Every render is serialized, so a queued render's wait is bounded two ways:
+ * the caller's `AbortSignal` (a fired deadline) and the queue budget. A waiter
+ * that gives up stays in the queue marked `aborted`; `release()` skips it, so
+ * the slot is always handed to a live waiter and never to a dead one.
+ *
+ * Exported for tests: the bounded/abortable wait is the contract that keeps a
+ * parallel search from hanging, and it is provable without a browser.
+ */
+export class RenderQueue {
+  private busy = false;
+  private waiting: Waiter[] = [];
+
+  constructor(private readonly queueTimeoutMs: number) {}
+
+  /** True while a render holds the slot. */
+  get isBusy(): boolean {
+    return this.busy;
+  }
+
+  /** Number of waiters still queued (including ones that gave up). */
+  get pending(): number {
+    return this.waiting.length;
+  }
+
+  /**
+   * Acquire the slot. Resolves `granted: true` when the slot is taken, or
+   * `granted: false` with a reason when the caller aborted or the queue budget
+   * expired — in which case the slot was never taken and nothing must be
+   * released by the caller.
+   */
+  acquire(signal?: AbortSignal): Promise<AcquireOutcome> {
+    if (signal?.aborted) {
+      return Promise.resolve({ granted: false, reason: "aborted" });
+    }
+    if (!this.busy) {
+      this.busy = true;
+      return Promise.resolve({ granted: true });
+    }
+    return new Promise<AcquireOutcome>((resolve) => {
+      const waiter: Waiter = { resolve: () => undefined, aborted: false };
+      let settled = false;
+
+      /** Settle the promise exactly once and release the waiter's resources. */
+      const settle = (granted: boolean, reason?: AcquireOutcome["reason"]): void => {
+        if (settled) return;
+        settled = true;
+        clearTimeout(timer);
+        signal?.removeEventListener("abort", onAbort);
+        resolve(reason ? { granted, reason } : { granted });
+      };
+
+      /** Give up on the wait: the caller aborted, or the queue budget expired. */
+      const giveUp = (reason: AcquireOutcome["reason"], detail: string): void => {
+        if (settled) return;
+        waiter.aborted = true;
+        console.error("[browshManager] queue wait ended early: %s", detail);
+        settle(false, reason);
+      };
+
+      function onAbort(): void {
+        giveUp("aborted", "caller aborted while queued");
+      }
+
+      waiter.resolve = (granted: boolean): void => {
+        if (granted) {
+          waiter.aborted = false;
+          settle(true);
+        } else {
+          settle(false);
+        }
+      };
+
+      // Deliberately NOT unref()ed: a queued wait must still fire its timeout
+      // even if nothing else holds the event loop, or the queue budget becomes
+      // a lie in a short-lived process (a queued render would hang instead of
+      // failing honestly). The render itself holds the loop while in flight,
+      // so keeping this handle referenced costs nothing.
+      const timer = setTimeout(
+        () => giveUp("queue-timeout", `queue timeout after ${this.queueTimeoutMs}ms`),
+        this.queueTimeoutMs
+      );
+
+      signal?.addEventListener("abort", onAbort, { once: true });
+      this.waiting.push(waiter);
+    });
+  }
+
+  /** Release the slot, handing control to the first live waiter if any. */
+  release(): void {
+    // Skip waiters that gave up while queued (aborted, or queue timeout): the
+    // slot must be handed to a live waiter, never to a dead one.
+    while (this.waiting.length > 0) {
+      const next = this.waiting.shift()!;
+      if (next.aborted) continue;
+      next.resolve(true);
+      return;
+    }
+    this.busy = false;
+  }
+}
+
 /**
  * Manages the single Browsh instance lifecycle: lazy start, health probing,
  * request serialization (mutex), request-count-based recycling, and idle kill.
@@ -86,6 +240,7 @@ class BrowshManager {
   private readonly firefoxPath: string;
   private readonly healthPath: string = "/";
   private readonly requestTimeoutMs: number;
+  private readonly queueTimeoutMs: number;
   private readonly startupTimeoutMs: number;
   private readonly recycleThreshold: number;
   private readonly idleTimeoutMs: number;
@@ -94,8 +249,7 @@ class BrowshManager {
   private readonly rows: number;
 
   private requestCount = 0;
-  private busy = false;
-  private waiting: Array<() => void> = [];
+  private readonly queue: RenderQueue;
   private idleTimer: ReturnType<typeof setTimeout> | null = null;
   private lastCycleAt = 0;
 
@@ -103,12 +257,32 @@ class BrowshManager {
     // Get path from env or default to "firefox"
     this.firefoxPath =
       firefoxPath || process.env.BROWSH_FIREFOX_PATH || "firefox";
-    this.requestTimeoutMs = Number(process.env.BROWSH_REQUEST_TIMEOUT_MS) || 30_000;
+    // Per-render timeout. Raised from 30s: a rendered search-engine page
+    // routinely takes 10-20s on a cold or busy host, and a 30s cap turned a
+    // merely slow page into a failed render. Raised again to 180s for slow
+    // hosts behind heavy JS pages. The mutex queue wait is bounded separately
+    // (BROWSH_QUEUE_TIMEOUT_MS), so a slow render cannot become an unbounded
+    // hang.
+    //
+    // All three render-path budgets come from one resolver so the values that
+    // run are the values a test can assert the ladder invariant on.
+    const budgets = resolveRenderTimeouts();
+    this.requestTimeoutMs = budgets.render;
+    // Queue-wait budget: how long a render may sit behind the mutex before it
+    // fails with an honest error. The per-render timeout only starts once the
+    // mutex is granted, so without this bound a queued render could wait
+    // indefinitely while the caller saw nothing at all.
+    //
+    // MUST stay >= BROWSH_REQUEST_TIMEOUT_MS * 2: the worst single-query chain
+    // queues a render behind another render, and a queue budget smaller than
+    // one render can only ever produce false timeouts. The search budget
+    // (SEARCH_DEADLINE_MS) must in turn exceed this value plus one render.
+    this.queueTimeoutMs = budgets.queue;
     // Cold-start budget for the Browsh HTTP endpoint. Measured 31s on a warm
     // profile in the fat image, so the old hardcoded 30s window killed the
     // browser about one second before it was ready and every first fetch after
-    // a container start failed. Configurable; default leaves real headroom.
-    this.startupTimeoutMs = clampIntEnv(process.env.BROWSH_STARTUP_TIMEOUT_MS, 10_000, 300_000, 60_000, "BROWSH_STARTUP_TIMEOUT_MS");
+    // a container start failed. Raised to 120s for slow hosts. Configurable.
+    this.startupTimeoutMs = budgets.startup;
     this.recycleThreshold = Number(process.env.BROWSH_RECYCLE_REQUESTS) || 100;
     this.idleTimeoutMs = Number(process.env.BROWSH_IDLE_TIMEOUT_MS) || 600_000;
     // Persistent Firefox profile: Browsh 1.8.0 offers no profile-dir flag, so
@@ -120,6 +294,7 @@ class BrowshManager {
     // the explicit 160x60 env replaces any 80x24 fallback in the launcher path.
     this.cols = clampIntEnv(process.env.BROWSH_COLS, 80, 250, 160, "BROWSH_COLS");
     this.rows = clampIntEnv(process.env.BROWSH_ROWS, 24, 100, 60, "BROWSH_ROWS");
+    this.queue = new RenderQueue(this.queueTimeoutMs);
   }
 
   /** Start Browsh if not running. */
@@ -233,29 +408,18 @@ class BrowshManager {
   }
 
   /**
-   * Acquire the busy mutex. Browsh requests are strictly serialized: if a
-   * request is in flight, waiters queue in FIFO order. This guarantees any
-   * recycle/idle-kill decided later only ever sees a quiescent process.
+   * Acquire the render slot. Delegates to the queue, which bounds the wait by
+   * the caller's signal and the queue budget. See {@link RenderQueue.acquire}.
    */
-  private async acquire(): Promise<void> {
-    console.error("[browshManager] acquire (busy=%s, waiting=%d)", this.busy, this.waiting.length);
-    if (!this.busy) {
-      this.busy = true;
-      return;
-    }
-    return new Promise<void>((resolve) => {
-      this.waiting.push(resolve);
-    });
+  private acquire(signal?: AbortSignal): Promise<AcquireOutcome> {
+    console.error("[browshManager] acquire (busy=%s, waiting=%d)", this.queue.isBusy, this.queue.pending);
+    return this.queue.acquire(signal);
   }
 
-  /** Release the mutex, handing control to the first waiter if any. */
+  /** Release the render slot, handing control to the first live waiter. */
   private release(): void {
-    console.error("[browshManager] release (waiting=%d)", this.waiting.length);
-    if (this.waiting.length > 0) {
-      this.waiting.shift()!();
-    } else {
-      this.busy = false;
-    }
+    console.error("[browshManager] release (waiting=%d)", this.queue.pending);
+    this.queue.release();
   }
 
   /**
@@ -269,7 +433,18 @@ class BrowshManager {
     mode: "PLAIN" | "DOM",
     signal?: AbortSignal
   ): Promise<string> {
-    await this.acquire();
+    const outcome = await this.acquire(signal);
+    if (!outcome.granted) {
+      // The wait ended without the mutex: the request was aborted, or it sat
+      // behind the mutex past the queue budget. No render was attempted and the
+      // mutex was never taken, so nothing is released here.
+      throw new FetchError(
+        outcome.reason === "aborted"
+          ? "Render cancelled: the request was aborted before it could acquire the browser"
+          : `Render failed: the request waited behind the browser mutex for more than ${this.queueTimeoutMs}ms without being served`,
+        { url }
+      );
+    }
     try {
       return await this.fetchRawInner(url, mode, false, signal);
     } finally {
@@ -420,7 +595,7 @@ class BrowshManager {
       // Re-check the counter: an earlier queued callback may have recycled and
       // reset it already, so a new process must not be immediately killed.
       if (this.requestCount < this.recycleThreshold) return;
-      if (this.busy || this.waiting.length > 0) {
+      if (this.queue.isBusy || this.queue.pending > 0) {
         this.scheduleRecycle();
         return;
       }
diff --git a/src/cache.ts b/src/cache.ts
index 3f5834d..ac3166b 100644
--- a/src/cache.ts
+++ b/src/cache.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /** Small in-memory TTL cache. */
 export class TtlCache<K, V> {
   private store = new Map<K, { expiresAt: number; value: V }>();
diff --git a/src/errors.ts b/src/errors.ts
index daacbf1..b5e6fd3 100644
--- a/src/errors.ts
+++ b/src/errors.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /** Fetch error with optional HTTP status code, thrown instead of returned as strings. */
 export class FetchError extends Error {
   readonly statusCode?: number;
diff --git a/src/extract.ts b/src/extract.ts
index acb6ec4..fe8c501 100644
--- a/src/extract.ts
+++ b/src/extract.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 import { load, type CheerioAPI } from "cheerio";
 import type { Element } from "domhandler";
 
diff --git a/src/guard.ts b/src/guard.ts
index 1f0388c..9391573 100644
--- a/src/guard.ts
+++ b/src/guard.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 /**
  * Bot-wall / guard detection for rendered page content.
  *
diff --git a/src/html2markdownManager.ts b/src/html2markdownManager.ts
index 54909d4..8eed782 100644
--- a/src/html2markdownManager.ts
+++ b/src/html2markdownManager.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 import { spawn } from "child_process";
 
 /**
diff --git a/src/server.ts b/src/server.ts
index 1dcc852..8c99178 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 import dotenv from "dotenv";
 import { z } from "zod";
 import { Server } from "@modelcontextprotocol/sdk/server/index.js";
@@ -47,7 +48,7 @@ const tools = [
         must_contain: { type: "string", description: "Probe mode: verify the page mentions a string/pattern WITHOUT loading full content into context. Returns MATCH/NO-MATCH + up to 3 excerpts. Case-insensitive substring, or /regex/ (e.g. \"/CVE-2026-\\d+/\"). Full fetch still happens internally; only output collapses." },
         archive: { type: "string", enum: ["auto", "only", "off"], description: "Wayback resurrection: auto (default when set): on hard failure (404/paywall/timeout/network) serve nearest archived snapshot labeled with date; when no snapshot exists the original error is rethrown unchanged; only: skip live fetch, go straight to archive; off: never." },
         stitch: { type: "boolean", description: "Multi-page articles: follow rel=next and return WHOLE article in one call (up to 6 parts / 48k chars) with *(part N)* markers, same-host only." },
-        deadline_ms: { type: "number", description: "Hard time budget in ms (500-600000). On expiry: honest deadline.hit error, never a silent hang." },
+        deadline_ms: { type: "number", description: "Hard time budget in ms (500-1800000). Defaults to SEARCH_DEADLINE_MS (900000) when omitted, so a search always ends in results or an honest deadline.hit error. On expiry: in-flight renders are aborted and the budget is never silently exceeded." },
         tier: { type: "string", enum: ["auto", "1", "2"], description: "auto (default): HTTP first, auto-escalates to browser. \"1\": HTTP only (no browser). \"2\": browser directly (slower, skips HTTP)." },
         links: { type: "boolean", description: "Include [text](url) link URLs. Default true (blowsh). Set false to save ~30% tokens (matches DonSeTch default false)." },
         media: { type: "boolean", description: "Include image alt text and sources. Default true. Set false to strip media." },
@@ -64,7 +65,8 @@ const tools = [
       "Search the web through rendered search engines and return ranked results (title, url, snippet). " +
       "Engines: DuckDuckGo HTML, Bing, Brave, Mojeek (concurrently) fused by cross-engine consensus. " +
       "Use to discover pages, then feed URLs to fetch_web/extract_links. " +
-      "DonSeTch-parity: `query_variants` (up to 2 alternate formulations, searched in parallel), `intent` (auto/web/code/paper/news/entity selects verticals: GitHub, Wikipedia, arXiv, HN), `deadline_ms` (hard budget: on expiry with zero data returns cheap-fallback partials or an honest deadline.hit error, never a bare empty result).",
+      "DonSeTch-parity: `query_variants` (up to 2 alternate formulations, searched in parallel), `intent` (auto/web/code/paper/news/entity selects verticals: GitHub, Wikipedia, arXiv, HN), `deadline_ms` (hard budget: on expiry with zero data returns cheap-fallback partials or an honest deadline.hit error, never a bare empty result). " +
+      "When `deadline_ms` is omitted the search runs under `SEARCH_DEADLINE_MS` (default 900000 ms) and aborts its in-flight renders on expiry, so it never hangs past the budget. Engines that recently answered with a bot-block page are remembered and skipped for a short window, which keeps parallel variant searches from paying for dead tiers.",
     inputSchema: {
       type: "object",
       properties: {
@@ -74,7 +76,7 @@ const tools = [
         enrich: { type: "boolean", description: "When true, top-3 snippets are replaced with fetched markdown (best-effort)" },
         query_variants: { type: "array", items: { type: "string" }, description: "Optional alternate formulations of the same information need (max 2). Searched in parallel; results merged with dedup." },
         intent: { type: "string", enum: ["auto", "web", "code", "paper", "news", "entity"], description: "auto (default) detects from query. code: adds GitHub vertical; paper: arXiv; news: HN; entity: Wikipedia; web: general only." },
-        deadline_ms: { type: "number", description: "Hard time budget in ms (500-600000). On expiry: honest deadline error, never a silent hang." },
+        deadline_ms: { type: "number", description: "Hard time budget in ms (500-1800000). Defaults to SEARCH_DEADLINE_MS (900000) when omitted, so a search always ends in results or an honest deadline error, never a silent hang." },
       },
       required: ["query"],
     },
@@ -160,7 +162,7 @@ const selectors = {
     must_contain: z.string().optional(),
     archive: z.enum(["auto", "only", "off"]).optional(),
     stitch: z.boolean().optional(),
-    deadline_ms: z.number().int().min(500).max(600_000).optional(),
+    deadline_ms: z.number().int().min(500).max(1_800_000).optional(),
     tier: z.enum(["auto", "1", "2"]).optional(),
     links: z.boolean().optional(),
     media: z.boolean().optional(),
@@ -174,7 +176,7 @@ const selectors = {
     enrich: z.boolean().optional(),
     query_variants: z.array(z.string()).max(2).optional(),
     intent: z.enum(["auto", "web", "code", "paper", "news", "entity"]).optional(),
-    deadline_ms: z.number().int().min(500).max(600_000).optional(),
+    deadline_ms: z.number().int().min(500).max(1_800_000).optional(),
   }),
   extract_links: z.object({
     url: z.string(),
@@ -186,7 +188,7 @@ const selectors = {
     selector: z.string().optional(),
     max_chars: z.number().int().min(100).max(2_000_000).optional(),
     wait_ms: z.number().int().min(0).max(60_000).optional(),
-    deadline_ms: z.number().int().min(500).max(600_000).optional(),
+    deadline_ms: z.number().int().min(500).max(1_800_000).optional(),
   }),
   crawl_web: z.object({
     url: z.string(),
diff --git a/src/ssrf.ts b/src/ssrf.ts
index 2f3a911..f395466 100644
--- a/src/ssrf.ts
+++ b/src/ssrf.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
 import dns from "node:dns/promises";
 import net from "node:net";
 import { FetchError } from "./errors.js";
diff --git a/src/tools/DECISIONS.md b/src/tools/DECISIONS.md
index 3149479..cca433f 100644
--- a/src/tools/DECISIONS.md
+++ b/src/tools/DECISIONS.md
@@ -13,3 +13,44 @@ Chronological Architectural Decision Records for the MCP tool handlers. Newest l
 **Consequences.** Image-only pages, PDF shells, and login walls that previously returned an empty string now throw. Agents get an actionable error naming the URL, the renderer branch, the DOM size, and the extracted text size. `renderOnce` now returns `RenderResult` instead of a bare string, which is the seam tests stub (Browsh and html2markdown are external binaries, absent on the dev host).
 
 **Rollback.** The threshold and the failure behaviour are one branch in `guardEmptyExtraction` plus one constant (`EMPTY_EXTRACTION_CODE`); removing the guard call in `render()` and the three bypass call sites restores the previous empty-success behaviour.
+
+## 2026-11-13 — Parallel searches were serialized behind an unbounded render queue
+
+**Context.** Multi-step parallel `search_web` calls (especially with `query_variants`) failed or timed out. The chain is not actually parallel: every render goes through one FIFO slot in `browshManager`, and `search_web` issues up to 6 renders per query (Tier 1 Google, Tier 2 Startpage, Tier 3 consensus pool of 4). With 3 queries that is 18 serialized renders. Two things made it worse: the per-render axios timeout started only *after* the slot was granted, so queue wait was unbounded and invisible to the caller; and `search_web` had no outer deadline unless the caller passed `deadline_ms`, so the client gave up while the server was still rendering.
+
+**Decision.** Bound and abort the queue wait, then stop paying for dead tiers.
+
+1. `RenderQueue` (extracted from `BrowshManager` so the contract is testable without a browser) takes the request's `AbortSignal` and a `BROWSH_QUEUE_TIMEOUT_MS` budget (default 600000 ms). A queued render that is cancelled or waits too long fails with an honest `FetchError`. A waiter that gives up stays in the queue marked `aborted`; `release()` skips it, so the slot is never handed to a settled promise.
+2. `BROWSH_REQUEST_TIMEOUT_MS` default raised 30000 → 180000 ms, so a merely slow page is no longer a failed render. Raising a per-render timeout alone is incoherent — it sits in a ladder with the queue bound and the search budget (see the ladder ADR below), so all four budgets moved together.
+3. A blocked-engine breaker remembers an engine whose page matched `isBlockedPage()` for 10 minutes and skips it on later searches. The breaker may only skip an engine while another candidate is untried, so it can never empty a working search.
+4. `search_web` now runs under a budget for every call: `deadline_ms` when given, otherwise `SEARCH_DEADLINE_MS` (default 900000 ms). On expiry it aborts its in-flight renders (releasing the slot) and returns cheap-fallback partials or an honest `deadline.hit`. The `deadline_ms` ceiling rose 600000 → 1800000 ms.
+5. Enrichment is clamped to the remaining search budget and each fetch inherits that remaining window.
+
+**Alternatives rejected.** (a) First-success abort of the consensus pool — it would collapse the 4-engine consensus into winner-takes-all and break the documented ranking contract. (b) Shrinking the pool to two engines — same contract violation. Latency was recovered from dead tiers and bounded waits instead. (c) Bounding only the queue wait and leaving the overall call unbounded — the call could still run far past any client timeout.
+
+**Consequences.** A render that would previously wait forever now fails with an honest error naming the queue wait. A search that exceeds its budget fails with `deadline.hit` at 180 s instead of hanging, which is a visible behaviour change for callers on very slow hosts; `deadline_ms` overrides it. A bot-blocked engine stops costing renders for 10 minutes, so the first search after a block still pays, later ones do not. `RenderQueue` is exported and covered by `tests/search-timeout-hardening-tests.ts` (no browser, no network).
+
+**Rollback.** Each change is an independent edit: restore the `BROWSH_REQUEST_TIMEOUT_MS` and `SEARCH_DEADLINE_MS` defaults in `.env.example`, delete the breaker block in `searchWeb.ts`, and restore the previous `acquire()`/`release()` pair. The new env knobs are additive, so removing their use restores the previous behaviour exactly. The queue timer must stay referenced (not `unref()`ed) — an unreferenced queue timer never fires and turns the queue budget into a no-op.
+
+## 2026-11-13 — The four timeout budgets are one ladder, not four knobs
+
+**Context.** The first pass raised the per-render timeout to 90 s and left the search budget at 180 s. Those two numbers contradict each other: the queue wait alone was allowed 240 s, so the search budget could expire before the queue bound ever mattered, and 180 s funds only two of the up-to-six renders a query needs. Raising `BROWSH_REQUEST_TIMEOUT_MS` on its own (the literal request) would have made this worse, because a longer render inside a fixed budget means fewer renders fit.
+
+**Decision.** Treat the budgets as one ladder and state the invariant: `SEARCH_DEADLINE_MS ≥ BROWSH_QUEUE_TIMEOUT_MS + BROWSH_REQUEST_TIMEOUT_MS`, and the queue funds at least two renders (`queue ≥ 2 × render`). Defaults moved together:
+
+| Knob | Was | Now |
+| --- | --- | --- |
+| `BROWSH_REQUEST_TIMEOUT_MS` | 90000 | 180000 |
+| `BROWSH_QUEUE_TIMEOUT_MS` | 240000 | 600000 |
+| `SEARCH_DEADLINE_MS` | 180000 | 900000 |
+| `ENRICH_BUDGET_MS` | 45000 | 180000 |
+| `BROWSH_STARTUP_TIMEOUT_MS` | 60000 | 120000 |
+| `deadline_ms` ceiling | 600000 | 1800000 |
+
+The invariant is asserted in `tests/search-timeout-hardening-tests.ts` (the `timeout ladder` group) rather than four separate literal checks, so a future edit that raises one knob alone fails there with the actual arithmetic printed. Verified by lowering `SEARCH_DEADLINE_MS` to 300000: the suite reports `search budget (300000) covers queue + render (780000): FAIL — 300000 < 780000` and exits 1.
+
+**Alternatives rejected.** (a) Raising only the render timeout, as literally requested — it breaks the budget arithmetic and produces more false timeouts, not fewer. (b) Removing the queue bound and relying on the search deadline alone — that reintroduces the unbounded wait the first pass fixed. (c) Hardcoding the invariant as a startup assertion that refuses to boot — a bad env value should still start and fail honestly per request, not take the server down.
+
+**Consequences.** A slow host can now complete a full tier chain inside one budget. Worst-case latency for a single search rose from 180 s to 900 s, which is the point: the previous ceiling was too low to ever succeed on a cold or busy host. `BROWSH_STARTUP_TIMEOUT_MS` rose to 120 s so a slow cold start no longer fails the first fetch. The `deadline_ms` ceiling rose to 1800000 ms in the schema, the runtime clamp, and the docs together, so a schema-valid value can never be silently clamped lower again.
+
+**Rollback.** Every value is an env knob with the previous number as a one-line edit; the ladder assertion reads the exported constants (`DEFAULT_RENDER_TIMEOUT_MS`, `DEFAULT_QUEUE_TIMEOUT_MS`, `DEFAULT_STARTUP_TIMEOUT_MS`, `ENRICH_BUDGET_MS`, `resolveSearchDeadline`), so restoring the old numbers restores the old behaviour and the old assertion results.
diff --git a/src/tools/README.md b/src/tools/README.md
index c6c8f52..2399bc9 100644
--- a/src/tools/README.md
+++ b/src/tools/README.md
@@ -5,7 +5,7 @@ One file per tool. Each handler validates with zod, calls `assertSafeUrl` first,
 | File | Tool | Notes |
 | --- | --- | --- |
 | `fetchWeb.ts` | `fetch_web` | plain/html/markdown/pdf + selector, focus, toc/section, must_contain, archive, stitch, tier, links/media, since_last, offset |
-| `searchWeb.ts` | `search_web` | Google-first tiered fallback → Startpage → 4-engine consensus + verticals; `ENRICH_BUDGET_MS` bounds enrich |
+| `searchWeb.ts` | `search_web` | Google-first tiered fallback → Startpage → 4-engine consensus + verticals; `SEARCH_DEADLINE_MS` default budget (explicit `deadline_ms` wins), `ENRICH_BUDGET_MS` bounds enrich, per-engine block breaker skips dead tiers |
 | `crawlWeb.ts` | `crawl_web` | Sitemap-aware crawl, Governor pacing, resume tokens, fingerprints |
 | `extractLinks.ts` | `extract_links` | Hyperlinks from rendered DOM |
 | `extractPdf.ts` | (pdf path) | SSRF-guarded download → pdftotext, size-capped |
@@ -23,3 +23,14 @@ A render that produces no usable text is an error, never a success body.
 - **Fallback:** markdown conversion retries once from the full DOM (`convertMarkdownWithRetry`) when the readability pass narrowed to an empty shell while the DOM still held text, and only then fails.
 - **Cache:** `pageCache` stores only content the guard already accepted; an empty body is never cached.
 
+## Search budgets and the render queue (`search_web`)
+
+A search is a chain of renders, and every render goes through one serialized browser slot. Without an explicit bound on that chain, a "parallel" search degrades into a long serial queue and the caller sees a hang.
+
+- **Two budgets, not one.** `BROWSH_REQUEST_TIMEOUT_MS` (default 180000 ms) bounds one render, and `BROWSH_QUEUE_TIMEOUT_MS` (default 600000 ms) bounds how long a render may wait behind the slot before it fails honestly. The per-render timeout only starts once the slot is granted, so the queue budget is what makes the chain bounded end to end.
+- **Queue wait is abortable.** `RenderQueue` in `browshManager.ts` takes the request's `AbortSignal`. A waiter whose signal fires leaves the queue marked `aborted`; `release()` skips it, so the slot is handed to a live waiter instead of deadlocking.
+- **Search deadline.** `search_web` runs under a wall-clock budget: the caller's `deadline_ms` when given, otherwise `SEARCH_DEADLINE_MS` (default 900000 ms, ceiling 1800000 ms). On expiry the in-flight renders are aborted — so a timed-out search stops holding the browser slot — and the call returns cheap-fallback partials or an honest `deadline.hit`.
+- **The budgets form a ladder.** `SEARCH_DEADLINE_MS` ≥ `BROWSH_QUEUE_TIMEOUT_MS` + `BROWSH_REQUEST_TIMEOUT_MS`, and the queue funds at least two renders. Raising one knob alone breaks the chain: a search budget below queue + render aborts renders that were still legitimately queued, which is the failure this design exists to prevent. `tests/search-timeout-hardening-tests.ts` asserts the invariant, so a bad edit fails there rather than in production.
+- **Blocked-engine breaker.** An engine whose page matched `isBlockedPage()` is remembered as blocked for `SEARCH_BLOCKED_ENGINE_TTL_MS` (default 10 min). Known-dead tiers are skipped instead of costing a serialized render on every query, which is the main saving for parallel `query_variants` searches. The breaker may only skip an engine while another candidate is untried, so it can never turn a working search into an empty one.
+- **Enrichment stays in budget.** The enrichment phase is clamped to the remaining search budget, and each enrichment fetch inherits that remaining window.
+
diff --git a/src/tools/crawlWeb.ts b/src/tools/crawlWeb.ts
index 3057fbd..a4a19fc 100644
--- a/src/tools/crawlWeb.ts
+++ b/src/tools/crawlWeb.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/tools/README.md | Decisions: src/tools/DECISIONS.md
 import axios from "axios";
 import { load } from "cheerio";
 import { browshManager } from "../browshManager.js";
diff --git a/src/tools/extractLinks.ts b/src/tools/extractLinks.ts
index 5949c2b..c9d7ab6 100644
--- a/src/tools/extractLinks.ts
+++ b/src/tools/extractLinks.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/tools/README.md | Decisions: src/tools/DECISIONS.md
 import { load } from "cheerio";
 import { browshManager } from "../browshManager.js";
 import { assertSafeUrl } from "../ssrf.js";
diff --git a/src/tools/extractPdf.ts b/src/tools/extractPdf.ts
index d0deacb..6eace26 100644
--- a/src/tools/extractPdf.ts
+++ b/src/tools/extractPdf.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/tools/README.md | Decisions: src/tools/DECISIONS.md
 import axios from "axios";
 import { spawn } from "node:child_process";
 import { PassThrough } from "node:stream";
diff --git a/src/tools/fetchWeb.ts b/src/tools/fetchWeb.ts
index 2f5cc70..7ccdd29 100644
--- a/src/tools/fetchWeb.ts
+++ b/src/tools/fetchWeb.ts
@@ -90,6 +90,13 @@ export interface RenderResult {
 /** Stable machine-readable code for a render that produced no usable text. */
 export const EMPTY_EXTRACTION_CODE = "empty.extraction";
 
+/**
+ * Ceiling for an explicit `deadline_ms` (ms). Mirrors the zod schema cap in
+ * `server.ts`, so a value the schema accepts is never silently clamped lower
+ * here — that drift is what made a 700 s fetch budget collapse to 600 s.
+ */
+export const MAX_DEADLINE_MS = 1_800_000;
+
 /** Context carried into the empty-extraction guard. */
 export interface EmptyExtractionContext {
   url: string;
@@ -739,7 +746,9 @@ async function fetchWebNoGuard(opts: FetchWebOptions): Promise<string> {
   // NOTE: a deadline.hit message contains "timed out", not "timeout", so
   // isHardFailure() stays false and archive=auto never rescues it (documented).
   if (opts.deadline_ms && opts.deadline_ms > 0) {
-    const ms = Math.max(500, Math.min(600_000, opts.deadline_ms));
+    // Clamped to the same ceiling as the `deadline_ms` schema, so the cap here
+    // can never silently reject a value the schema accepted.
+    const ms = Math.max(500, Math.min(MAX_DEADLINE_MS, opts.deadline_ms));
     const deadlineError = createDeadlineError(`deadline.hit: fetch timed out after ${ms}ms for ${opts.url}`, opts.url);
     return Promise.race([
       fetchWebInner(opts),
diff --git a/src/tools/fetchWebBatch.ts b/src/tools/fetchWebBatch.ts
index c2f7bfb..06c3cdc 100644
--- a/src/tools/fetchWebBatch.ts
+++ b/src/tools/fetchWebBatch.ts
@@ -1,3 +1,4 @@
+// Sibling Docs: src/tools/README.md | Decisions: src/tools/DECISIONS.md
 import { fetchWeb, type FetchWebOptions } from "./fetchWeb.js";
 import { FetchError, toFetchErrorMessage } from "../errors.js";
 
diff --git a/src/tools/searchWeb.ts b/src/tools/searchWeb.ts
index c9dede8..173aae8 100644
--- a/src/tools/searchWeb.ts
+++ b/src/tools/searchWeb.ts
@@ -1,8 +1,10 @@
+// Sibling Docs: src/tools/README.md | Decisions: src/tools/DECISIONS.md
 import { load } from "cheerio";
 import axios from "axios";
 import { browshManager } from "../browshManager.js";
 import { assertSafeUrl } from "../ssrf.js";
 import { FetchError, createDeadlineError, isDeadlineHitError } from "../errors.js";
+import { TtlCache } from "../cache.js";
 import { fetchWeb } from "./fetchWeb.js";
 
 /**
@@ -29,7 +31,86 @@ export interface SearchResult {
 }
 
 /** Total wall-clock budget for the enrichment phase (ms). Overridable via ENRICH_BUDGET_MS. */
-const ENRICH_BUDGET_MS = Number(process.env.ENRICH_BUDGET_MS ?? 45_000);
+export const ENRICH_BUDGET_MS = intEnvOrDefault(process.env.ENRICH_BUDGET_MS, 180_000);
+
+/**
+ * Parse an integer env var with a fallback. Unlike `Number(...)` this rejects
+ * NaN, so a typo like `SEARCH_DEADLINE_MS=9e5s` cannot produce a NaN budget —
+ * which would make `setTimeout(fn, NaN)` fire in ~1 ms and abort every search
+ * instantly.
+ */
+function intEnvOrDefault(raw: string | undefined, fallback: number): number {
+  const n = Number.parseInt(raw ?? "", 10);
+  return Number.isFinite(n) && n > 0 ? n : fallback;
+}
+
+/**
+ * Default wall-clock budget for one search when the caller sets no deadline.
+ * A search always ends in results or an honest `deadline.hit` — never an
+ * unbounded hang. Overridable via SEARCH_DEADLINE_MS.
+ *
+ * MUST exceed `BROWSH_QUEUE_TIMEOUT_MS` + `BROWSH_REQUEST_TIMEOUT_MS` (the
+ * worst wait a single render can face before it even starts): a budget below
+ * that can only ever abort renders that were still legitimately queued, which
+ * is the failure this whole ladder exists to prevent.
+ */
+const DEFAULT_SEARCH_DEADLINE_MS = intEnvOrDefault(process.env.SEARCH_DEADLINE_MS, 900_000);
+
+/** Hard ceiling for the search budget — matches the `deadline_ms` schema cap. */
+export const MAX_SEARCH_DEADLINE_MS = 1_800_000;
+
+/**
+ * Engine ids in tier order. The blocked-engine breaker keys on these ids.
+ */
+const ENGINE_IDS = ["google", "startpage", "brave", "mojeek", "bing", "ddg"] as const;
+
+/**
+ * Engines that answered with a bot-block page are remembered for a short TTL
+ * so a known-dead engine stops costing a render on every search. The render
+ * mutex serializes all engines, so a blocked tier is pure latency: two dead
+ * tiers per query doubled the wall clock of every search.
+ */
+const blockedEngines = new TtlCache<string, true>(
+  Number(process.env.SEARCH_BLOCKED_ENGINE_TTL_MS) || 600_000
+);
+
+/**
+ * Resolves the wall-clock budget for one search. An explicit `deadline_ms`
+ * wins; otherwise the default applies, so the tool never runs unbounded.
+ */
+export function resolveSearchDeadline(deadlineMs?: number): number {
+  const requested =
+    deadlineMs !== undefined && deadlineMs > 0 ? deadlineMs : DEFAULT_SEARCH_DEADLINE_MS;
+  return Math.max(500, Math.min(MAX_SEARCH_DEADLINE_MS, requested));
+}
+
+/**
+ * True when the engine is remembered as blocked AND the breaker is allowed to
+ * act. The breaker may only skip an engine while another candidate is not
+ * known-blocked, so it can never turn a working search into an empty one.
+ */
+export function isEngineSkipped(id: string, breakerArmed: boolean): boolean {
+  return breakerArmed && blockedEngines.get(id) === true;
+}
+
+/** Records that an engine answered with a bot-block page. */
+export function markEngineBlocked(id: string): void {
+  blockedEngines.set(id, true);
+}
+
+/**
+ * True when the breaker may act: at least one candidate engine is not
+ * remembered as blocked. When this is false no engine is skipped at all, so
+ * the breaker can never turn a working search into an empty one.
+ */
+export function isBreakerArmed(ids: readonly string[] = ENGINE_IDS): boolean {
+  return ids.some((id) => !blockedEngines.get(id));
+}
+
+/** Clears the remembered blocked engines (test seam). */
+export function resetBlockedEngines(): void {
+  blockedEngines.clear();
+}
 
 // Simple in-memory query cache (intent-aware)
 const queryCache = new Map<string, { at: number; results: SearchResult[] }>();
@@ -592,26 +673,47 @@ async function fetchInstantAnswer(query: string): Promise<string | null> {
   }
 }
 
+/** Outcome of one engine render. */
+interface EngineRender {
+  /** Organic results parsed from the rendered page. */
+  results: SearchResult[];
+  /** True when the engine answered with a bot-block page instead of results. */
+  blocked: boolean;
+}
+
 /**
  * Renders one search engine page and parses its organic results. Bounded by
- * the shared browser mutex; cancellable via `signal` so the sibling engine
- * fetch can be aborted once the first engine returns results. An aborted
- * sibling resolves to `[]` (not an error); real failures rethrow.
+ * the shared browser mutex; cancellable via `signal` so a sibling engine fetch
+ * can be aborted once the budget expires. An aborted sibling resolves to an
+ * empty (not blocked) render — never an error; real failures rethrow.
+ *
+ * A bot-block page is recorded in the blocked-engine breaker, so the next
+ * search skips that engine instead of paying another serialized render for it.
  */
 async function renderEngine(
-  engine: { url: string; parse: (html: string) => SearchResult[] },
+  engine: { id: string; url: string; parse: (html: string) => SearchResult[] },
   signal?: AbortSignal
-): Promise<SearchResult[]> {
+): Promise<EngineRender> {
   await assertSafeUrl(engine.url);
   try {
     await browshManager.ensureStarted();
     const dom = await browshManager.fetchDom(engine.url, signal);
-    if (isBlockedPage(dom)) return [];
-    return engine.parse(dom);
+    if (isBlockedPage(dom)) {
+      markEngineBlocked(engine.id);
+      return { results: [], blocked: true };
+    }
+    return { results: engine.parse(dom), blocked: false };
   } catch (e) {
-    // An aborted sibling is not an error — the other engine already won.
-    if (axios.isCancel(e) || (axios.isAxiosError(e) && e.code === "ERR_CANCELED")) {
-      return [];
+    // An aborted render is not an error — the budget fired, or a sibling
+    // engine already won. The signal check also covers a render cancelled
+    // while it was queued behind the browser mutex: that path throws a
+    // FetchError, not an axios cancellation.
+    if (
+      axios.isCancel(e) ||
+      (axios.isAxiosError(e) && e.code === "ERR_CANCELED") ||
+      signal?.aborted
+    ) {
+      return { results: [], blocked: false };
     }
     throw e;
   }
@@ -681,9 +783,11 @@ async function searchSingleQuery(
   page: number,
   enrich: boolean,
   intent: SearchIntent,
-  deadlineMs?: number,
+  deadlineMs: number,
+  externalSignal?: AbortSignal,
   retried = false
 ): Promise<SearchResult[]> {
+  const startedAt = Date.now();
   const cacheKey = cacheKeyForQuery(query, intent);
   const cached = queryCache.get(cacheKey);
   const ttl = intentCacheTtl(intent, query);
@@ -704,6 +808,20 @@ async function searchSingleQuery(
 
   const controller = new AbortController();
   const deadlineTimer = deadlineMs ? setTimeout(() => controller.abort(), deadlineMs) : null;
+  // The caller's signal (the outer search budget) aborts the inner renders
+  // too, so a search that runs out of budget stops holding the browser mutex
+  // instead of rendering on in the background.
+  const onExternalAbort = (): void => controller.abort();
+  if (externalSignal?.aborted) {
+    controller.abort();
+  } else {
+    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
+  }
+
+  // The blocked-engine breaker may only skip an engine while another
+  // candidate is not known-blocked, so it can never turn a working search
+  // into an empty one.
+  const breakerArmed = isBreakerArmed();
 
   try {
     // 1. Kick off direct-HTTP calls in parallel (no Browsh mutex contention)
@@ -717,14 +835,19 @@ async function searchSingleQuery(
     // 2. Tier 1: Google (Primary attempt)
     // If Google succeeds and returns clean results, short-circuit immediately.
     const googleEngine = {
+      id: "google",
       url: googleSearchUrl(query, page),
       parse: (html: string) => parseGoogle(html, "https://www.google.com/"),
     };
 
     try {
-      const googleRes = await renderEngine(googleEngine, controller.signal);
-      if (googleRes.length > 0) {
-        engineResults.push(googleRes);
+      if (isEngineSkipped("google", breakerArmed)) {
+        console.error("[searchWeb] skipping tier-1 google: remembered as blocked");
+      } else {
+        const googleRender = await renderEngine(googleEngine, controller.signal);
+        if (googleRender.results.length > 0) {
+          engineResults.push(googleRender.results);
+        }
       }
     } catch (e) {
       if (!axios.isCancel(e) && !(axios.isAxiosError(e) && e.code === "ERR_CANCELED")) {
@@ -736,13 +859,18 @@ async function searchSingleQuery(
     // If Google was robot-blocked or yielded 0 results, try Startpage.
     if (engineResults.length === 0 && !controller.signal.aborted) {
       const startpageEngine = {
+        id: "startpage",
         url: startpageSearchUrl(query, page),
         parse: (html: string) => parseStartpage(html, "https://www.startpage.com/"),
       };
       try {
-        const startpageRes = await renderEngine(startpageEngine, controller.signal);
-        if (startpageRes.length > 0) {
-          engineResults.push(startpageRes);
+        if (isEngineSkipped("startpage", breakerArmed)) {
+          console.error("[searchWeb] skipping tier-2 startpage: remembered as blocked");
+        } else {
+          const startpageRender = await renderEngine(startpageEngine, controller.signal);
+          if (startpageRender.results.length > 0) {
+            engineResults.push(startpageRender.results);
+          }
         }
       } catch (e) {
         if (!axios.isCancel(e) && !(axios.isAxiosError(e) && e.code === "ERR_CANCELED")) {
@@ -755,19 +883,26 @@ async function searchSingleQuery(
     // Only triggered if both Google and Startpage failed or were blocked.
     if (engineResults.length === 0 && !controller.signal.aborted) {
       const fallbackEngines = [
-        { url: braveSearchUrl(query, page), parse: (html: string) => parseBrave(html, "https://search.brave.com/") },
-        { url: mojeekSearchUrl(query, page), parse: (html: string) => parseMojeek(html, "https://www.mojeek.com/") },
-        { url: bingSearchUrl(query, page), parse: (html: string) => parseBing(html, "https://www.bing.com/") },
-        { url: ddgSearchUrl(query, page), parse: (html: string) => parseDuckDuckGo(html, "https://duckduckgo.com/") },
+        { id: "brave", url: braveSearchUrl(query, page), parse: (html: string) => parseBrave(html, "https://search.brave.com/") },
+        { id: "mojeek", url: mojeekSearchUrl(query, page), parse: (html: string) => parseMojeek(html, "https://www.mojeek.com/") },
+        { id: "bing", url: bingSearchUrl(query, page), parse: (html: string) => parseBing(html, "https://www.bing.com/") },
+        { id: "ddg", url: ddgSearchUrl(query, page), parse: (html: string) => parseDuckDuckGo(html, "https://duckduckgo.com/") },
       ];
 
+      // Skip pool engines the breaker remembers as blocked, but never empty the
+      // pool: if every engine is known-blocked, try them all anyway.
+      const liveEngines = fallbackEngines.filter(
+        (engine) => !isEngineSkipped(engine.id, breakerArmed)
+      );
+      const poolEngines = liveEngines.length > 0 ? liveEngines : fallbackEngines;
+
       const poolOutcomes = await Promise.allSettled(
-        fallbackEngines.map(async (engine) => renderEngine(engine, controller.signal))
+        poolEngines.map(async (engine) => renderEngine(engine, controller.signal))
       );
 
       for (const o of poolOutcomes) {
-        if (o.status === "fulfilled" && o.value.length > 0) {
-          engineResults.push(o.value);
+        if (o.status === "fulfilled" && o.value.results.length > 0) {
+          engineResults.push(o.value.results);
         }
       }
     }
@@ -807,19 +942,28 @@ async function searchSingleQuery(
     if (merged.length === 0 && !instantAnswer && !retried && (intent === "news" || intent === "entity")) {
       const simple = simplifyQuery(query);
       if (simple && simple.toLowerCase() !== query.toLowerCase().replace(/\s+/g, " ").trim()) {
-        return searchSingleQuery(simple, maxResults, page, enrich, "web", deadlineMs, true);
+        return searchSingleQuery(simple, maxResults, page, enrich, "web", deadlineMs, externalSignal, true);
       }
     }
 
     // Enrichment: replace the top-3 organic snippets with fetched main-content
-    // markdown. Best-effort, sequential, and hard-bounded by a wall-clock budget
+    // markdown. Best-effort, sequential, and hard-bounded by a wall-clock budget.
+    // The phase is clamped to the remaining search budget and each fetch
+    // inherits it, so enrichment can never outlive the search it belongs to.
     if (enrich && merged.length > 0) {
-      const deadline = Date.now() + ENRICH_BUDGET_MS;
+      const budgetEnd = startedAt + deadlineMs;
+      const enrichEnd = Math.min(budgetEnd, Date.now() + ENRICH_BUDGET_MS);
       for (const result of merged.slice(0, 3)) {
-        if (Date.now() > deadline) break;
+        const remaining = enrichEnd - Date.now();
+        if (remaining < 1_000) break;
         if (controller.signal.aborted) break;
         try {
-          const markdown = await fetchWeb({ url: result.url, type: "markdown", max_chars: 1500 });
+          const markdown = await fetchWeb({
+            url: result.url,
+            type: "markdown",
+            max_chars: 1500,
+            deadline_ms: remaining,
+          });
           result.snippet = markdown.trim();
         } catch (e) {
           console.error(`[searchWeb] Enrichment failed for ${result.url}: ${e instanceof Error ? e.message : String(e)}`);
@@ -845,6 +989,7 @@ async function searchSingleQuery(
     return sliced;
   } finally {
     if (deadlineTimer) clearTimeout(deadlineTimer);
+    externalSignal?.removeEventListener("abort", onExternalAbort);
   }
 }
 
@@ -858,6 +1003,11 @@ async function searchSingleQuery(
  * merged by consensus (cross-engine agreement) + dedup, rather than winner-takes-all.
  * Intent verticals (github, wikipedia, arxiv, hn) are added when intent dictates.
  * Query variants run in parallel and are merged.
+ *
+ * Every search runs under a wall-clock budget: the caller's `deadline_ms`
+ * when given, otherwise `SEARCH_DEADLINE_MS` (default 900000 ms). When the budget
+ * expires the in-flight renders are aborted — so a timed-out search stops
+ * holding the browser mutex — and the call ends in an honest `deadline.hit`.
  */
 export async function searchWeb(
   query: string,
@@ -873,6 +1023,16 @@ export async function searchWeb(
   const currentPage = Math.max(1, Math.min(10, page));
   const resolvedIntent = detectIntent(query, intent);
 
+  // Wall-clock budget for the whole search. An explicit `deadline_ms` wins;
+  // otherwise the default applies, so a search never runs unbounded.
+  const budgetMs = resolveSearchDeadline(deadlineMs);
+  const startedAt = Date.now();
+
+  // One controller for the whole search: when the budget expires it aborts
+  // every in-flight render, so a timed-out search stops holding the browser
+  // mutex instead of rendering on in the background.
+  const budgetController = new AbortController();
+
   // Deadline wrapper for the whole operation (honest deadline error, never hang)
   const run = async (): Promise<SearchResult[]> => {
     // Handle query variants: base + up to 2 variants in parallel, merged
@@ -880,7 +1040,7 @@ export async function searchWeb(
     const queries = [query, ...variants];
 
     if (queries.length === 1) {
-      return searchSingleQuery(query, max, currentPage, enrich, resolvedIntent, deadlineMs);
+      return searchSingleQuery(query, max, currentPage, enrich, resolvedIntent, budgetMs, budgetController.signal);
     }
 
     // Variants: search each query in parallel, then merge per-query result sets with dedup across variants
@@ -889,7 +1049,7 @@ export async function searchWeb(
     // fallback); swallowing it into [] would re-introduce the bare-[] bug.
     const perQueryResults = await Promise.all(
       queries.map((q) =>
-        searchSingleQuery(q, max, currentPage, false, resolvedIntent, deadlineMs).catch((e: unknown) => {
+        searchSingleQuery(q, max, currentPage, false, resolvedIntent, budgetMs, budgetController.signal).catch((e: unknown) => {
           if (isDeadlineHitError(e)) throw e;
           return [] as SearchResult[];
         })
@@ -899,13 +1059,20 @@ export async function searchWeb(
     // Merge across variants: dedup by URL, keep highest consensus
     const flatMerged = mergeResults(perQueryResults);
 
-    // Enrich after merge if requested (once)
+    // Enrich after merge if requested (once), clamped to the search budget.
     if (enrich && flatMerged.length > 0) {
-      const deadline = Date.now() + ENRICH_BUDGET_MS;
+      const budgetEnd = startedAt + budgetMs;
+      const enrichEnd = Math.min(budgetEnd, Date.now() + ENRICH_BUDGET_MS);
       for (const result of flatMerged.slice(0, 3)) {
-        if (Date.now() > deadline) break;
+        const remaining = enrichEnd - Date.now();
+        if (remaining < 1_000) break;
         try {
-          const markdown = await fetchWeb({ url: result.url, type: "markdown", max_chars: 1500 });
+          const markdown = await fetchWeb({
+            url: result.url,
+            type: "markdown",
+            max_chars: 1500,
+            deadline_ms: remaining,
+          });
           result.snippet = markdown.trim();
         } catch { /* ignore */ }
       }
@@ -916,27 +1083,41 @@ export async function searchWeb(
     return flatMerged.slice(0, max);
   };
 
-  if (deadlineMs && deadlineMs > 0) {
-    const timeoutMs = Math.max(500, Math.min(600_000, deadlineMs));
-    const deadlineError = createDeadlineError(`deadline.hit: search timed out after ${timeoutMs}ms (query: ${query})`);
-    return Promise.race([
-      run(),
-      new Promise<SearchResult[]>((_, reject) => setTimeout(() => reject(deadlineError), timeoutMs)),
-    ]).catch(async (e) => {
-      // Deadline with zero data is the worst failure mode: try a cheap
-      // browser-free fallback (plain HTTP engine pages) and return whatever
-      // it yields as partial results. Only throw when fallback is empty too.
-      if (!isDeadlineHitError(e)) throw e;
-      try {
-        const partial = await fetchCheapFallback(query, max);
-        if (partial.length > 0) {
-          console.error(`[searchWeb] deadline.hit — returning ${partial.length} cheap-fallback partial results`);
-          return partial;
-        }
-      } catch { /* fall through to original error */ }
-      throw e;
-    });
-  }
+  const deadlineError = createDeadlineError(
+    `deadline.hit: search timed out after ${budgetMs}ms (query: ${query})`
+  );
+
+  let budgetTimer: ReturnType<typeof setTimeout> | null = null;
+  const budgetPromise = new Promise<SearchResult[]>((_, reject) => {
+    // Deliberately NOT unref()ed, matching the RenderQueue timer: a budget
+    // that can be starved of the event loop is not a budget. If this timer
+    // were the only referenced handle it would never fire, and the search
+    // would hang past its own deadline. The timer is always cleared in the
+    // finally below, so keeping it referenced costs nothing.
+    budgetTimer = setTimeout(() => {
+      // Abort first: the in-flight renders release the browser mutex instead of
+      // rendering on for another full budget after the caller gave up.
+      budgetController.abort();
+      reject(deadlineError);
+    }, budgetMs);
+  });
 
-  return run();
+  try {
+    return await Promise.race([run(), budgetPromise]);
+  } catch (e) {
+    // Deadline with zero data is the worst failure mode: try a cheap
+    // browser-free fallback (plain HTTP engine pages) and return whatever
+    // it yields as partial results. Only throw when fallback is empty too.
+    if (!isDeadlineHitError(e)) throw e;
+    try {
+      const partial = await fetchCheapFallback(query, max);
+      if (partial.length > 0) {
+        console.error(`[searchWeb] deadline.hit — returning ${partial.length} cheap-fallback partial results`);
+        return partial;
+      }
+    } catch { /* fall through to original error */ }
+    throw e;
+  } finally {
+    if (budgetTimer) clearTimeout(budgetTimer);
+  }
 }
diff --git a/tests/search-timeout-hardening-tests.ts b/tests/search-timeout-hardening-tests.ts
new file mode 100644
index 0000000..a34537d
--- /dev/null
+++ b/tests/search-timeout-hardening-tests.ts
@@ -0,0 +1,303 @@
+/**
+ * Search timeout hardening regression tests.
+ * Run with: npx tsx tests/search-timeout-hardening-tests.ts
+ *
+ * Scope: no live network, no Browsh, no Firefox. These cover the two failure
+ * modes that made parallel multi-step searches fail and time out:
+ *
+ *  1. The render mutex serialized every engine, and a queued render had no
+ *     bound at all — the caller saw a hang, not an error. RenderQueue proves
+ *     the wait is bounded by the queue budget and by the caller's AbortSignal,
+ *     and that an aborted waiter never deadlocks the next one.
+ *  2. `search_web` had no outer deadline unless the caller passed one, and
+ *     dead tiers (Google/Startpage, usually robot-blocked) cost a render on
+ *     every search. The budget resolver and the blocked-engine breaker are
+ *     proved here, including the safety property that the breaker may never
+ *     skip the last untried engine.
+ *
+ *  3. The four budgets form one ladder: a render timeout, a queue wait, a
+ *     search deadline, and an enrichment budget. The ladder is asserted as an
+ *     invariant (search >= queue + render) rather than as four magic numbers,
+ *     so a future edit that raises one knob alone fails here instead of
+ *     silently producing false timeouts.
+ */
+
+import {
+  DEFAULT_QUEUE_TIMEOUT_MS,
+  DEFAULT_RENDER_TIMEOUT_MS,
+  DEFAULT_STARTUP_TIMEOUT_MS,
+  RenderQueue,
+  resolveRenderTimeouts,
+} from "../src/browshManager.js";
+import {
+  ENRICH_BUDGET_MS,
+  MAX_SEARCH_DEADLINE_MS,
+  isBreakerArmed,
+  isEngineSkipped,
+  markEngineBlocked,
+  resetBlockedEngines,
+  resolveSearchDeadline,
+} from "../src/tools/searchWeb.js";
+
+let failures = 0;
+let checks = 0;
+
+function check(name: string, passed: boolean, detail = ""): void {
+  checks++;
+  if (passed) {
+    console.log(`${name}: PASS`);
+  } else {
+    failures++;
+    console.log(`${name}: FAIL${detail ? ` — ${detail}` : ""}`);
+  }
+}
+
+/** Lets queued microtasks settle without waiting on a wall clock. */
+function tick(): Promise<void> {
+  return new Promise((resolve) => setTimeout(resolve, 0));
+}
+
+async function testRenderQueue(): Promise<void> {
+  console.log("\n[RenderQueue — bounded and abortable wait]");
+
+  // A. The free slot is granted immediately.
+  {
+    const q = new RenderQueue(5_000);
+    const out = await q.acquire();
+    check("free slot is granted immediately", out.granted === true && q.isBusy);
+    q.release();
+    check("slot frees after release", q.isBusy === false && q.pending === 0);
+  }
+
+  // B. A second waiter queues FIFO and is granted on release.
+  {
+    const q = new RenderQueue(5_000);
+    await q.acquire();
+    const second = q.acquire();
+    await tick();
+    check("second waiter is queued while the slot is busy", q.pending === 1);
+    q.release();
+    const out = await second;
+    check("queued waiter is granted on release", out.granted === true);
+    check("slot stays busy across the hand-off", q.isBusy === true);
+    q.release();
+    check("slot frees once the last waiter releases", q.isBusy === false && q.pending === 0);
+  }
+
+  // C. Aborting a queued waiter hands the slot to the next LIVE waiter.
+  //    This is the no-deadlock property: release() must skip a waiter that
+  //    already gave up instead of handing the slot to an already-settled
+  //    promise, which would leave the slot busy forever.
+  {
+    const q = new RenderQueue(60_000);
+    await q.acquire();
+    const dead = new AbortController();
+    const live = new AbortController();
+    const deadWait = q.acquire(dead.signal);
+    const liveWait = q.acquire(live.signal);
+    await tick();
+    check("two waiters queue behind a busy slot", q.pending === 2);
+
+    dead.abort();
+    const deadOut = await deadWait;
+    check(
+      "aborted waiter reports aborted, not granted",
+      deadOut.granted === false && deadOut.reason === "aborted",
+      JSON.stringify(deadOut)
+    );
+
+    q.release();
+    const liveOut = await liveWait;
+    check(
+      "aborted waiter is skipped and the live waiter gets the slot",
+      liveOut.granted === true,
+      JSON.stringify(liveOut)
+    );
+    check("aborted waiter leaves no residue in the queue", q.pending === 0);
+
+    q.release();
+    check("no deadlock: slot frees after the aborted waiter is skipped", q.isBusy === false);
+  }
+
+  // D. The queue budget expires instead of waiting forever.
+  {
+    const q = new RenderQueue(20);
+    await q.acquire();
+    const out = await q.acquire();
+    check(
+      "queue budget expiry reports queue-timeout, not granted",
+      out.granted === false && out.reason === "queue-timeout",
+      JSON.stringify(out)
+    );
+    q.release();
+    check("slot frees after a queue-timeout waiter", q.isBusy === false);
+  }
+
+  // E. An already-aborted signal never takes the slot.
+  {
+    const q = new RenderQueue(5_000);
+    const c = new AbortController();
+    c.abort();
+    const out = await q.acquire(c.signal);
+    check(
+      "already-aborted signal does not take the slot",
+      out.granted === false && out.reason === "aborted" && q.isBusy === false,
+      JSON.stringify(out)
+    );
+  }
+}
+
+function testBudget(): void {
+  console.log("\n[search_web — default budget]");
+
+  if (process.env.SEARCH_DEADLINE_MS) {
+    console.log(
+      `[search-timeout-hardening] SEARCH_DEADLINE_MS is set (${process.env.SEARCH_DEADLINE_MS}); ` +
+        "the literal-default assertion is skipped."
+    );
+  } else {
+    check(
+      "default budget is 900000 when SEARCH_DEADLINE_MS is unset",
+      resolveSearchDeadline(undefined) === 900_000
+    );
+  }
+
+  check("explicit budget wins over the default", resolveSearchDeadline(12_345) === 12_345);
+  check("zero budget falls back to the default", resolveSearchDeadline(0) === resolveSearchDeadline(undefined));
+  check("negative budget falls back to the default", resolveSearchDeadline(-5) === resolveSearchDeadline(undefined));
+  check("budget clamps up to the 500ms floor", resolveSearchDeadline(10) === 500);
+  check("budget clamps down to the 1800000ms ceiling", resolveSearchDeadline(99_999_999) === 1_800_000);
+  check("ceiling constant is 1800000", MAX_SEARCH_DEADLINE_MS === 1_800_000);
+  // A malformed env value must fall back, never become NaN. NaN propagates
+  // through Math.min/Math.max and makes setTimeout(fn, NaN) fire in ~1 ms,
+  // which would abort every search instantly.
+  check("NaN budget falls back instead of propagating", Number.isFinite(resolveSearchDeadline(Number("abc"))));
+  check(
+    "malformed env budget resolves to a sane default",
+    (() => {
+      const v = resolveSearchDeadline(Number("abc"));
+      return Number.isFinite(v) && v === resolveSearchDeadline(undefined);
+    })()
+  );
+  check(
+    "default budget stays inside the allowed band",
+    (() => {
+      const d = resolveSearchDeadline(undefined);
+      return d >= 500 && d <= MAX_SEARCH_DEADLINE_MS;
+    })()
+  );
+}
+
+function testBreaker(): void {
+  console.log("\n[search_web — blocked-engine breaker]");
+
+  resetBlockedEngines();
+  check("unblocked engine is never skipped", isEngineSkipped("google", true) === false);
+  check("breaker is armed when nothing is remembered", isBreakerArmed(["google"]) === true);
+
+  markEngineBlocked("google");
+  check("blocked engine is skipped while armed", isEngineSkipped("google", true) === true);
+  check("other engines are still tried", isEngineSkipped("brave", true) === false);
+  check(
+    "breaker stays armed while another candidate is live",
+    isBreakerArmed(["google", "brave"]) === true
+  );
+
+  markEngineBlocked("brave");
+  check(
+    "with every candidate blocked the breaker is disarmed",
+    isBreakerArmed(["google", "brave"]) === false
+  );
+  check(
+    "disarmed breaker never skips, so the search is never emptied",
+    isEngineSkipped("google", isBreakerArmed(["google", "brave"])) === false
+  );
+
+  resetBlockedEngines();
+  check("reset clears the breaker", isEngineSkipped("google", true) === false);
+  check("reset re-arms the breaker", isBreakerArmed(["google"]) === true);
+}
+
+function testLadder(): void {
+  console.log("\n[timeout ladder — the budgets must agree]");
+
+  const render = DEFAULT_RENDER_TIMEOUT_MS;
+  const queue = DEFAULT_QUEUE_TIMEOUT_MS;
+  const search = resolveSearchDeadline(undefined);
+
+  // The invariant: a queued render must be able to finish inside the search
+  // budget. queue is the longest a render may wait for the slot, and render is
+  // how long it then needs — a search budget below their sum aborts renders
+  // that were still legitimately queued, which is the failure this ladder
+  // exists to prevent.
+  check(
+    `search budget (${search}) covers queue + render (${queue + render})`,
+    search >= queue + render,
+    `${search} < ${queue + render}`
+  );
+
+  // The queue budget must fund at least two renders: the worst single-query
+  // chain queues a render behind another one.
+  check(
+    `queue budget (${queue}) funds two renders (${render * 2})`,
+    queue >= render * 2,
+    `${queue} < ${render * 2}`
+  );
+
+  // Each render must be allowed at least one render's worth of enrichment.
+  check(
+    `enrich budget (${ENRICH_BUDGET_MS}) funds one render (${render})`,
+    ENRICH_BUDGET_MS >= render,
+    `${ENRICH_BUDGET_MS} < ${render}`
+  );
+
+  // Every budget must sit inside its own accepted range.
+  check("render timeout is positive", render > 0);
+  check("startup budget funds the measured ~31s cold start", DEFAULT_STARTUP_TIMEOUT_MS >= 31_000);
+  check("search budget is inside the deadline band", search >= 500 && search <= MAX_SEARCH_DEADLINE_MS);
+
+  // N3 (QA follow-up): the four checks above read the DEFAULT constants, so a
+  // bad env combination that clamps each knob into its own band but breaks the
+  // ladder would pass. Assert on the values that actually run instead.
+  const live = resolveRenderTimeouts(process.env);
+  const liveSearch = resolveSearchDeadline(process.env.SEARCH_DEADLINE_MS ? Number(process.env.SEARCH_DEADLINE_MS) : undefined);
+  check(
+    `env-resolved ladder holds: search (${liveSearch}) covers queue + render (${live.queue + live.render})`,
+    liveSearch >= live.queue + live.render,
+    `env BROWSH_QUEUE_TIMEOUT_MS/BROWSH_REQUEST_TIMEOUT_MS/SEARCH_DEADLINE_MS break the ladder`
+  );
+  check(
+    `env-resolved queue (${live.queue}) funds two renders (${live.render * 2})`,
+    live.queue >= live.render * 2,
+    "env BROWSH_QUEUE_TIMEOUT_MS < 2 x BROWSH_REQUEST_TIMEOUT_MS"
+  );
+
+  // A deliberately bad combination must be caught, not silently clamped into
+  // something that looks fine per-knob.
+  const bad = resolveRenderTimeouts({
+    BROWSH_REQUEST_TIMEOUT_MS: "180000",
+    BROWSH_QUEUE_TIMEOUT_MS: "200000",
+  } as NodeJS.ProcessEnv);
+  check(
+    `a per-knob-valid but ladder-breaking env is detectable (${bad.queue} < ${bad.render * 2})`,
+    bad.queue < bad.render * 2,
+    "expected the bad combination to violate queue >= 2 x render"
+  );
+}
+
+async function main(): Promise<void> {
+  await testRenderQueue();
+  testBudget();
+  testLadder();
+  testBreaker();
+
+  console.log("");
+  if (failures > 0) {
+    console.log(`${failures} of ${checks} check(s) FAILED`);
+    process.exitCode = 1;
+    return;
+  }
+  console.log(`all ${checks} checks passed`);
+}
+
+await main();
```
<!-- END_GIT_DIFF -->
