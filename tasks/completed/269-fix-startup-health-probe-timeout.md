# Task 269: Fix the Browsh startup health probe timeout

**File:** `tasks/completed/269-fix-startup-health-probe-timeout.md`
**Source:** manager
**Type:** bug
**Status:** closed
**Submitted:** 2026-11-20T10:28:07Z

## Goal

Fix the false "Browsh did not start in HTTP mode within timeout" failure. The startup health probe uses a hardcoded 800 ms axios timeout against Browsh's `/` endpoint, which renders a full page and takes about 1–2 s on this host. The probe therefore never succeeds even though Browsh is up and answering HTTP 200.

## Manager's Notes

Direct order: audit the blowsh source in the home directory, find the bug, and fix it. The operator also authorized shutting down WARP and Psiphon if blowsh works without them. ZAC holds.

## Relevant Code Context

- `src/browshManager.ts:549` — `axios.get(endpoint, { timeout: 800 })` inside `waitForReady`.
- `src/browshManager.ts:535-539` — `spawnAndWait` throws the false startup-timeout error after the whole startup budget elapses.
- `src/browshManager.ts:424-440` — `ensureStarted` quarantines the profile on ANY boot failure, including a pure probe timeout, which can discard a healthy profile.
- `src/browshManager.ts:79-100` — `resolveRenderTimeouts` is the single resolver for render-path budgets; it is the right place for the new probe budget.
- `tests/search-timeout-hardening-tests.ts:221-286` — ladder assertions read `resolveRenderTimeouts`.
- `src/README.md`, `src/DECISIONS.md`, `.env.example`, `README.md`, `CHANGELOG.md` — docs to synchronize.

## Local TODOs

- [x] Move task to `tasks/in-progress/` before editing
- [x] Add a configurable health-probe timeout with a realistic default and use it in `waitForReady`
- [x] Stop quarantining a healthy profile on a pure probe timeout
- [x] Add regression assertions and update sibling docs, env example, and CHANGELOG
- [x] Build with strict `tsc` and run the offline suites
- [x] Verify a real render in Docker, then move to `tasks/qa/`

## QA Hotfix Checklist

- [x] Step 1 — Harden quarantine guard in `src/browshManager.ts` with the shared `BROWSH_STARTUP_TIMEOUT_MESSAGE` constant and the exported `isStartupProbeTimeout` helper. The guard uses a substring match and the throw site uses the shared constant; ESM import of `FetchError` was reused, no `require` added.
- [x] Step 2 — Add regression coverage in `tests/search-timeout-hardening-tests.ts` for exact match, suffixed message, unrelated boot error, non-FetchError, wiring (`timeout: this.healthProbeTimeoutMs`), absence of `timeout: 800`, and probe-below-startup ladder.
- [x] Step 3 — Fix the stale lane reference in `CHANGELOG.md` (`See Task 269`).
- [x] Step 4 — Rebuild, rerun all three suites, and record fresh evidence in this task file.

## Acceptance Criteria

- [x] `waitForReady` no longer uses the hardcoded 800 ms timeout; the probe timeout has a default of at least 5000 ms and is configurable through an env knob clamped to a documented range.
- [x] A pure startup-probe timeout no longer quarantines the Firefox profile.
- [x] Offline tests assert the new default and the env override, and all suites pass.
- [x] Strict `tsc` build passes with exit code 0.
- [x] A real Docker `fetch_web` render succeeds through the fixed build, with the result recorded in Verification Evidence.
- [x] Sibling docs, `.env.example`, README, and CHANGELOG are updated; diff staged via MCP; task moved to `tasks/qa/`.

## Verification Evidence

- **Test command:** `rtk test npx tsx tests/search-timeout-hardening-tests.ts && rtk test npx tsx tests/proxy-config-tests.ts && rtk test npx tsx tests/browser-crash-circuit-tests.ts`
- **Expected result:** all offline suites exit 0.
- **Actual result:** `all 45 checks passed`; `17/17 checks passed`; `all 29 checks passed`.
- **Exit code:** `0` for all three.
- **Raw diagnostic rerun:** the first RTK run of suite 1 failed one new assertion (`health probe timeout is clamped to its floor: got 5000`). Raw rerun confirmed `clampIntEnv` falls back to the default for an out-of-band value instead of snapping to the band edge. The assertion was corrected to match that contract; no production code was weakened.

> Verification runner rule: the first run of each suite used the `rtk test` prefix; the raw rerun above followed a failed RTK run for detailed diagnostics.

**Autopilot re-verification (2026-11-20, fresh run):** re-ran the full gate from a clean check. `rtk test npm run build` exit 0 (tsc strict, no errors). `rtk test npx tsx tests/search-timeout-hardening-tests.ts` → `all 45 checks passed`, exit 0, with stderr log `BROWSH_HEALTH_PROBE_TIMEOUT_MS=100 out of range [1000,60000], using 5000` confirming the clamp path. `rtk test npx tsx tests/proxy-config-tests.ts` → `17/17 checks passed`, exit 0. `rtk test npx tsx tests/browser-crash-circuit-tests.ts` → `all 29 checks passed`, exit 0. Docker rebuilt from this working tree as `blowsh-mcp:269-verify` (exit 0) and an MCP JSON-RPC smoke test `initialize → tools/call fetch_web {url: https://example.com, type: plain}` returned `isError: false` with rendered text (`This domain is for use in documentation examples…`), guard_type null, elapsed_ms 13668. Full output at `/tmp/opencode/smoke269.out`. The `timeout` wrapper reported 124 only because the harness held stdin open after the response; the MCP result is the render evidence.

**Build evidence:** `rtk test npm run build` (tsc strict) — output `> tsc`, exit code `0`.
**Live evidence:** `docker build -t blowsh-mcp:local-fix .` exit 0; container recreated with `PROXY_TYPE=none`; `curl http://127.0.0.1:8107/health` → `{"status":"ok","transport":"streamable-http"}`; `fetch_web` on `https://example.com` returned `This domain is for use in documentation examples...` with `isError:false` in 10 s; logs show `acquire (busy=false, waiting=0)` and `release (waiting=0)`.
**Strict tooling gate:** TypeScript/Node repo with strict `tsc` as the configured gatekeeper (no lint configured). Format and lint steps are not configured in this repo; the gate is `npm run build` then the three offline suites, all exit 0. No Node-hexagonal stack skill loaded: this is a plain Node MCP server with no ports/adapters layering. Stack skill skip recorded: root `/home/mohammad/blowsh-mcp`, markers scanned `package.json`/`tsconfig.json`/`Dockerfile`, matched skills `[]`, reason "plain Node MCP server, no hexagonal or NestJS markers".

**QA hotfix re-verification (2026-11-20, post-rejection):** `rtk test npm run build` exit 0. `rtk test npx tsx tests/search-timeout-hardening-tests.ts` → `all 52 checks passed`, exit 0 (seven new guard/ladder/wiring checks). `rtk test npx tsx tests/proxy-config-tests.ts` → `17/17 checks passed`, exit 0. `rtk test npx tsx tests/browser-crash-circuit-tests.ts` → `all 29 checks passed`, exit 0. `grep -rn "timeout: 800" src/browshManager.ts` exit 1 with zero hits, as required. `grep -n "healthProbeTimeoutMs" src/browshManager.ts` exit 0 with three hits: field declaration line 351, constructor assignment line 404, and `waitForReady` axios call line 597. Loop-guard diff hash `7a11c47d0df76887b20ca98c70846806e97d71afd82e147806218c1f5345695a` recorded manually; the `loop_guard` MCP tool is not exposed in this session's catalog, so no tool call was made.

## Definition of Done

- [x] Build/Test pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded
- [x] No autonomous commit; staged via `custom_context_stage_and_inject_diff`

## Risk & Rollback

- **Risk:** a longer per-probe timeout can delay failure detection inside the overall startup budget; the budget loop remains bounded by `BROWSH_STARTUP_TIMEOUT_MS`.
- **Rollback:** restore the 800 ms literal and the unconditional quarantine; no data migration.

---

## Execution Log & Reasoning

**Seat Check:** domain = silent startup failure in a TypeScript MCP server → Senior Programmer requested (silent-failure trigger). Architect skipped (no new architecture). Designer skipped (no UI). Brainstorm: not required — localized bug with a proven root cause and a bounded fix.

**Mode:** autopilot (locked by Manager at user request). ZAC holds. No commit will be made.

**Autopilot saga notes:** Assumption A1: the Manager's "Run auto pilot over the task" authorizes driving the existing implementation through verification, QA, and review; the plan is the task file's Goal plus Local TODOs, already Manager-authored, so no new plan round was opened. Assumption A2: when the task file was found in `tasks/qa/` mid-flight with staged changes, that state was accepted as a valid prior QA transition rather than reverted; all gates were re-run fresh against the same working tree. No hard blockers. QA budget checked at 0/1 before transition.

**Code audit findings (2026-11-20):**
- **F1 (root cause):** `waitForReady` hardcodes `timeout: 800` for `http://127.0.0.1:4333/`. That endpoint re-renders Browsh's welcome page (measured 0.9-2 s here), so every probe timed out while the endpoint returned HTTP 200. `spawnAndWait` then reported a false startup failure after the whole 120 s budget.
- **F2 (design flaw):** `ensureStarted`'s catch quarantined the Firefox profile on any boot-path error, including a pure probe timeout. A healthy profile could be discarded and a second full startup budget paid for nothing. Now rethrown unchanged for that specific `FetchError`.
- **F3 (audit clearance):** `proxyConfig.applyProxyEnv` correctly merges `localhost,127.0.0.1` into both `NO_PROXY` casings, and `proxy-config-tests.ts` covers it. The proxy environment is not the cause of the control-channel failure. Verified live: with proxying off the health endpoint still took 915-927 ms, above 800 ms.
- **F4 (audit clearance):** `fetchRawInner` already uses `this.requestTimeoutMs` for real renders, so the defect is isolated to the startup probe. No other hardcoded sub-second timeout exists in the render path.

**Change:** added `DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5000` and the `probe` field in `resolveRenderTimeouts` from `BROWSH_HEALTH_PROBE_TIMEOUT_MS` (clamped 1000-60000); `waitForReady` uses it. Added the timeout-specific quarantine guard. Updated three regression assertions, `.env.example`, README, `src/DECISIONS.md` ADR, root CHANGELOG. Sibling docs inspected before editing: `src/README.md` (module table unchanged — no new module), `src/DECISIONS.md` (ADR appended).

**Verification note:** one new test assertion initially expected edge clamping; raw rerun showed `clampIntEnv` falls back to the safe default when out of band. The assertion was corrected to the real contract; production code was not weakened.

**QA verdict (first pass): QA_REJECTED.** Findings V1, M1, and M2 were fully addressed. V2 and V3 were addressed only to the extent the Brain's hotfix XML prescribed.

- **V1 (guard fragility):** the quarantine bypass used exact string equality, so an HTTP status suffix or wording shift would fail closed and quarantine a healthy profile. Fixed with shared `BROWSH_STARTUP_TIMEOUT_MESSAGE` plus exported `isStartupProbeTimeout`, which uses a substring match and rejects non-FetchError. Both throw sites now use the constant.
- **M1 (guard untested):** added four guard cases, exact match, suffixed message, unrelated boot error, and non-FetchError.
- **M2 (wiring untested):** added source assertions for `timeout: this.healthProbeTimeoutMs` and absence of `timeout: 800`.
- **V2 (probe floor 1000 ms):** the prescribed hotfix does not raise the floor. The safe default remains 5000 ms, and `.env.example` plus README already state the clamp band and the measured ~1 s control-page render. Recorded as a residual risk rather than widening beyond the approved XML.
- **V3 (probe ceiling 60000 ms vs startup clamp 10000 ms):** added the `probe < startup` ladder assertion for default budgets. An operator can still set probe 60000 with startup 10000; that combination is documented here as a residual risk, not changed in this hotfix.

**Documentation phase:** inspected `src/README.md`, which has no timeout-knob table, so no row was added. `src/DECISIONS.md` already holds the ADR from the implementation. `.env.example`, root README, and CHANGELOG document the knob and guard. The only doc change in the hotfix is the lane-independent CHANGELOG reference.

## Decision Log

**[2026-11-20] [D1] [EXECUTION-DETECTED]:** Replace exact equality in the startup-probe quarantine guard with a shared timeout message constant and an exported substring-match helper.
- **Rationale:** QA showed that a status suffix or wording change would silently restore quarantine of a healthy Firefox profile. Sharing the message constant also removes the duplicated literal at the throw site.
- **Alternatives considered:** keep exact equality with a comment; match on `FetchError.statusCode`; rethrow every `FetchError` from the boot path. Each was rejected as fragile or too broad, since genuine path and lock failures must still quarantine.
- **Impact:** quarantine stays reserved for genuine boot failures, and regression tests now cover suffix and non-FetchError cases. No data migration.

**QA outcome:** first pass `QA_REJECTED` (guard fragility, untested guard, untested wiring). Hotfix applied; re-audit returned `QA_PASSED` with cites `src/browshManager.ts:597`, `src/browshManager.ts:465`, `src/browshManager.ts:125`, `tests/search-timeout-hardening-tests.ts:306`, `CHANGELOG.md:5`, `.env.example:57`.

**Code Review outcome:** `PO_REVIEW_PENDING` — technically approved. Strengths S1-S5 cover probe wiring, guard robustness, resolver clamp, regression coverage, and docs sync. Issues I1 (probe floor 1000 ms) and I2 (probe ceiling 60000 ms vs a small startup budget) are low, documented as residual, and out of scope for this fix. Recommendation R1 is to raise the floor or add probe-below-startup validation later if slow hosts need it.

**Gate:** Manager relayed closure-approval answer, exact value "Approved for closure" (question tool, 2026-11-20). QA_PASSED and PO_REVIEW_PENDING verified present before closure. Closure XML issued once via Senior Programmer, file moved `tasks/qa/` → `tasks/completed/`, header set to completed path and `Status: closed`. Commit goes through `custom_context_commit_and_clean_task` only; ZAC holds for all Git CLI writes.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/.env.example b/.env.example
index 6ce286f..f0cf0a1 100644
--- a/.env.example
+++ b/.env.example
@@ -54,6 +54,12 @@ SEARCH_BLOCKED_ENGINE_TTL_MS=600000
 # first fetch after a container start; raise this on slow hosts.
 BROWSH_STARTUP_TIMEOUT_MS=120000
 
+# Per-probe timeout for the Browsh control-channel health check in milliseconds
+# (default 5000, clamped 1000-60000). Browsh renders its welcome page on every
+# probe, which takes ~1s on a busy host; the old hardcoded 800ms made startup
+# fail even though the endpoint was answering HTTP 200. Raise on very slow hosts.
+BROWSH_HEALTH_PROBE_TIMEOUT_MS=5000
+
 # Browser session health
 # ----------------------
 # Number of requests after which the Browsh process is recycled (default 100)
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 83f2796..4caa3e3 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -2,6 +2,10 @@
 
 ## [Unreleased]
 
+### Fixed
+
+- False "Browsh did not start in HTTP mode within timeout" on slow hosts. The startup health probe in `src/browshManager.ts` used a hardcoded 800 ms axios timeout against Browsh's `/` endpoint, which re-renders the welcome page and takes ~0.9-2 s here, so every probe timed out while the endpoint was answering HTTP 200. Added `BROWSH_HEALTH_PROBE_TIMEOUT_MS` (default 5000, clamped 1000-60000) through `resolveRenderTimeouts`, and used it in `waitForReady`. The overall `BROWSH_STARTUP_TIMEOUT_MS` budget is unchanged. Also stopped quarantining a healthy Firefox profile on a pure probe timeout; quarantine remains reserved for path and lock failures. Regression assertions added to `tests/search-timeout-hardening-tests.ts`. See Task 269.
+
 ## [2.8.0] - 2026-11-20
 
 ### Added
diff --git a/README.md b/README.md
index 2687884..51ab620 100644
--- a/README.md
+++ b/README.md
@@ -282,6 +282,7 @@ Set these via `.env` (loaded automatically) or the environment:
 | `BROWSH_QUEUE_TIMEOUT_MS`   | `600000`      | How long a render may wait behind the serialized slot before it fails honestly (ms). Keep ≥ 2× the render timeout. |
 | `SEARCH_DEADLINE_MS`        | `900000`      | Default wall-clock budget for one `search_web` call when `deadline_ms` is omitted (ms). Keep ≥ queue wait + render timeout. |
 | `BROWSH_STARTUP_TIMEOUT_MS` | `120000`      | Cold-start budget for the Browsh HTTP endpoint (ms); the measured cold start is ~31 s. |
+| `BROWSH_HEALTH_PROBE_TIMEOUT_MS` | `5000`   | Per-probe timeout for the startup health check (ms, clamped 1000-60000). Browsh re-renders its welcome page on every probe (~1 s here), so a probe shorter than that reports a false startup timeout. |
 | `SEARCH_BLOCKED_ENGINE_TTL_MS` | `600000`   | How long an engine that answered with a bot-block page is remembered and skipped (10 min). |
 | `ENRICH_BUDGET_MS` | `180000` | Wall-clock budget for the `search_web` enrich phase (ms); each enrichment is a full render. |
 | `PDF_MAX_BYTES`             | `20971520`    | Max PDF file size in bytes for `fetch_web type: pdf`.                    |
diff --git a/src/DECISIONS.md b/src/DECISIONS.md
index 3c8519e..260e88c 100644
--- a/src/DECISIONS.md
+++ b/src/DECISIONS.md
@@ -111,3 +111,15 @@ Sibling of `src/README.md`. Tool-level records live in `src/tools/DECISIONS.md`.
 **Consequences.** One `.env` contract covers both egress paths without an image rebuild. Direct mode is deterministic across profile reuse. SOCKS5 selects `socks5h` for axios so DNS resolves remotely; operators whose Node-side HTTP client cannot handle a SOCKS URL should use `PROXY_TYPE=http` for axios while keeping a SOCKS proxy in front of Firefox. Firefox builds that prompt for proxy credentials in headless mode need an IP-allowlisted proxy for browser renders.
 
 **Rollback.** Remove the six variables and `src/proxyConfig.ts`, revert the two call sites, and delete the generated `user.js`. `prefs.js` on an existing profile may retain proxy values until the profile volume is reset.
+
+## 2026-11-20 — The startup health probe gets its own budget
+
+**Context.** A deployment behind an upstream proxy reported `FetchError: Browsh did not start in HTTP mode within timeout` on every render. Direct live measurement showed Browsh's control endpoint answering HTTP 200 within 0.9-2 s, well inside the 120 s startup budget. The cause was `waitForReady`'s hardcoded 800 ms axios timeout: it is shorter than one render of Browsh's welcome page, so every probe failed before the endpoint could answer. Two related flaws made the symptom worse: the startup budget was raised from 120 s to 300 s with no effect, and `ensureStarted` quarantined the Firefox profile on any boot-path error, including this pure timeout, so a healthy profile could be discarded and a second full budget paid for nothing.
+
+**Decision.** Add `DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5000` and expose `BROWSH_HEALTH_PROBE_TIMEOUT_MS` (clamped 1000-60000) through `resolveRenderTimeouts`, alongside the existing render, queue, and startup budgets. `waitForReady` uses that value per probe; the outer `BROWSH_STARTUP_TIMEOUT_MS` loop still bounds total startup time. In `ensureStarted`, a `FetchError` whose message is the startup-timeout text is rethrown unchanged, without profile quarantine. Profile quarantine stays reserved for path and lock failures.
+
+**Alternatives rejected.** (a) Raising `BROWSH_STARTUP_TIMEOUT_MS` — already tried at 300 s; the per-probe timeout is independent, so it cannot help. (b) Removing the upstream proxy — the slow probe reproduces with proxying off, so the proxy is not the root cause. (c) Replacing `/` with a lightweight Browsh health route — Browsh 1.8.0 exposes no such route. (d) Removing the profile quarantine entirely — it is the correct response to a genuine corrupt-profile storm (2026-11-14 ADR).
+
+**Consequences.** A slow-but-healthy browser is now detected in one probe instead of failing after the whole startup budget. Worst-case failure detection inside startup rises from 800 ms to 5 s per probe, still bounded by the startup loop. Operators on unusually slow hosts can raise the knob without touching the render ladder.
+
+**Rollback.** Restore the literal `800` in `waitForReady`, remove the `probe` field and env knob, and delete the timeout guard in `ensureStarted`. No data migration.
diff --git a/src/browshManager.ts b/src/browshManager.ts
index 94e4446..2c2027e 100644
--- a/src/browshManager.ts
+++ b/src/browshManager.ts
@@ -78,6 +78,39 @@ function cleanPlainText(text: string): string {
 export const DEFAULT_RENDER_TIMEOUT_MS = 180_000;
 export const DEFAULT_QUEUE_TIMEOUT_MS = 600_000;
 export const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
+/**
+ * Per-probe budget for the Browsh control-channel health check.
+ *
+ * Browsh's `/` endpoint renders its welcome page on every request; measured
+ * latency on a busy host is 0.9-2 s, and a proxy adds more. The old hardcoded
+ * 800 ms probe therefore always timed out and the manager reported a false
+ * "Browsh did not start in HTTP mode within timeout" even though the endpoint
+ * was answering HTTP 200. Five seconds absorbs normal render latency while a
+ * genuinely absent endpoint still fails quickly inside the startup budget.
+ */
+export const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5_000;
+
+/**
+ * Shared message for the startup health-probe timeout. The quarantine guard
+ * matches against this constant so a later wording or status-suffix change
+ * cannot silently restore profile quarantine on a slow-but-healthy browser.
+ */
+export const BROWSH_STARTUP_TIMEOUT_MESSAGE = "Browsh did not start in HTTP mode within timeout";
+
+/**
+ * True only when the error is the startup health-probe timeout.
+ *
+ * A pure probe timeout means the control page was slow, not that the Firefox
+ * profile is corrupt, so `ensureStarted` must skip quarantine for it. The
+ * substring match keeps a `FetchError` with an `[http <status>]` suffix
+ * recognised; a non-FetchError or any other boot error returns false and
+ * leaves the quarantine path intact for genuine path and lock failures.
+ */
+export function isStartupProbeTimeout(e: unknown): boolean {
+  if (!(e instanceof FetchError)) return false;
+  const msg: unknown = (e as Error).message;
+  return typeof msg === "string" && msg.includes(BROWSH_STARTUP_TIMEOUT_MESSAGE);
+}
 
 /**
  * Resolve the render-path budgets the same way the constructor does, so a test
@@ -89,11 +122,13 @@ export function resolveRenderTimeouts(env: NodeJS.ProcessEnv = process.env): {
   render: number;
   queue: number;
   startup: number;
+  probe: number;
 } {
   return {
     render: clampIntEnv(env.BROWSH_REQUEST_TIMEOUT_MS, 10_000, 600_000, DEFAULT_RENDER_TIMEOUT_MS, "BROWSH_REQUEST_TIMEOUT_MS"),
     queue: clampIntEnv(env.BROWSH_QUEUE_TIMEOUT_MS, 10_000, 1_200_000, DEFAULT_QUEUE_TIMEOUT_MS, "BROWSH_QUEUE_TIMEOUT_MS"),
     startup: clampIntEnv(env.BROWSH_STARTUP_TIMEOUT_MS, 10_000, 600_000, DEFAULT_STARTUP_TIMEOUT_MS, "BROWSH_STARTUP_TIMEOUT_MS"),
+    probe: clampIntEnv(env.BROWSH_HEALTH_PROBE_TIMEOUT_MS, 1_000, 60_000, DEFAULT_HEALTH_PROBE_TIMEOUT_MS, "BROWSH_HEALTH_PROBE_TIMEOUT_MS"),
   };
 }
 
@@ -313,6 +348,7 @@ class BrowshManager {
   private readonly requestTimeoutMs: number;
   private readonly queueTimeoutMs: number;
   private readonly startupTimeoutMs: number;
+  private readonly healthProbeTimeoutMs: number;
   private readonly recycleThreshold: number;
   private readonly idleTimeoutMs: number;
   private readonly profileDir: string;
@@ -362,6 +398,10 @@ class BrowshManager {
     // browser about one second before it was ready and every first fetch after
     // a container start failed. Raised to 120s for slow hosts. Configurable.
     this.startupTimeoutMs = budgets.startup;
+    // Per-probe budget for the health check. The overall startup window above
+    // still bounds the loop; this only stops a slow-but-healthy control page
+    // from being mistaken for a dead browser.
+    this.healthProbeTimeoutMs = budgets.probe;
     this.recycleThreshold = Number(process.env.BROWSH_RECYCLE_REQUESTS) || 100;
     this.idleTimeoutMs = Number(process.env.BROWSH_IDLE_TIMEOUT_MS) || 600_000;
     // Persistent Firefox profile: Browsh 1.8.0 offers no profile-dir flag, so
@@ -422,10 +462,18 @@ class BrowshManager {
       ensureFirefoxProxyPrefs(this.profileDir, resolveProxyConfig(process.env));
       await this.spawnAndWait();
     } catch (e) {
-      // Any boot-path failure (mkdir blocked by a file, spawn timeout from a
-      // stale lock / torn storage): quarantine the path, start fresh, warn
-      // loudly. Retry ONLY when quarantine actually moved the path aside;
-      // otherwise rethrow (bounded, never loops).
+      // A pure health-probe timeout means the control page was slow, not that
+      // the profile is corrupt. Quarantining here would discard a healthy
+      // profile and pay a second full startup budget for no reason. Surface
+      // the real error and let the caller decide; quarantine stays reserved
+      // for path/lock failures that actually justify a fresh profile.
+      if (isStartupProbeTimeout(e)) {
+        throw e;
+      }
+      // Any other boot-path failure (mkdir blocked by a file, stale lock, torn
+      // storage): quarantine the path, start fresh, warn loudly. Retry ONLY
+      // when quarantine actually moved the path aside; otherwise rethrow
+      // (bounded, never loops).
       const backup = quarantineProfileDir(this.profileDir);
       if (backup === null) {
         throw e;
@@ -535,7 +583,7 @@ class BrowshManager {
     const ready = await this.waitForReady(this.startupTimeoutMs);
     if (!ready) {
       await this.shutdown();
-      throw new FetchError(`Browsh did not start in HTTP mode within timeout`);
+      throw new FetchError(BROWSH_STARTUP_TIMEOUT_MESSAGE);
     }
   }
 
@@ -546,7 +594,7 @@ class BrowshManager {
     const start = Date.now();
     while (Date.now() - start < timeoutMs) {
       try {
-        const res = await axios.get(endpoint, { timeout: 800 });
+        const res = await axios.get(endpoint, { timeout: this.healthProbeTimeoutMs });
         if (res.status >= 200 && res.status < 500) return true;
       } catch {}
       await new Promise((res) => setTimeout(res, 400));
diff --git a/tests/search-timeout-hardening-tests.ts b/tests/search-timeout-hardening-tests.ts
index a34537d..bbfd9a1 100644
--- a/tests/search-timeout-hardening-tests.ts
+++ b/tests/search-timeout-hardening-tests.ts
@@ -22,13 +22,18 @@
  *     silently producing false timeouts.
  */
 
+import fs from "node:fs";
 import {
+  BROWSH_STARTUP_TIMEOUT_MESSAGE,
+  DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
   DEFAULT_QUEUE_TIMEOUT_MS,
   DEFAULT_RENDER_TIMEOUT_MS,
   DEFAULT_STARTUP_TIMEOUT_MS,
   RenderQueue,
+  isStartupProbeTimeout,
   resolveRenderTimeouts,
 } from "../src/browshManager.js";
+import { FetchError } from "../src/errors.js";
 import {
   ENRICH_BUDGET_MS,
   MAX_SEARCH_DEADLINE_MS,
@@ -255,6 +260,19 @@ function testLadder(): void {
   check("render timeout is positive", render > 0);
   check("startup budget funds the measured ~31s cold start", DEFAULT_STARTUP_TIMEOUT_MS >= 31_000);
   check("search budget is inside the deadline band", search >= 500 && search <= MAX_SEARCH_DEADLINE_MS);
+  // The health probe must outlast a real render of Browsh's welcome page
+  // (measured ~0.9-2 s here). The old hardcoded 800 ms made startup fail even
+  // though the endpoint was answering 200.
+  check(
+    `health probe default (${DEFAULT_HEALTH_PROBE_TIMEOUT_MS}ms) outlasts a slow control page`,
+    DEFAULT_HEALTH_PROBE_TIMEOUT_MS >= 5_000
+  );
+  const probeLive = resolveRenderTimeouts({ BROWSH_HEALTH_PROBE_TIMEOUT_MS: "9000" } as NodeJS.ProcessEnv);
+  check("health probe timeout is configurable", probeLive.probe === 9_000, `got ${probeLive.probe}`);
+  // clampIntEnv rejects an out-of-band value and uses the safe default; it
+  // does not snap to the band edge. Assert that contract, not a clamp.
+  const probeOutOfBand = resolveRenderTimeouts({ BROWSH_HEALTH_PROBE_TIMEOUT_MS: "100" } as NodeJS.ProcessEnv);
+  check("out-of-band health probe falls back to the safe default", probeOutOfBand.probe === DEFAULT_HEALTH_PROBE_TIMEOUT_MS, `got ${probeOutOfBand.probe}`);
 
   // N3 (QA follow-up): the four checks above read the DEFAULT constants, so a
   // bad env combination that clamps each knob into its own band but breaks the
@@ -285,10 +303,27 @@ function testLadder(): void {
   );
 }
 
+function testStartupProbeGuard(): void {
+  const exact = new FetchError(BROWSH_STARTUP_TIMEOUT_MESSAGE);
+  check("probe guard matches exact startup timeout", isStartupProbeTimeout(exact) === true);
+  const suffixed = new FetchError(`${BROWSH_STARTUP_TIMEOUT_MESSAGE} [http 500]`);
+  check("probe guard matches suffixed message", isStartupProbeTimeout(suffixed) === true);
+  const other = new FetchError("mkdir blocked by file");
+  check("probe guard rejects other boot error", isStartupProbeTimeout(other) === false);
+  const generic = new Error(BROWSH_STARTUP_TIMEOUT_MESSAGE);
+  check("probe guard rejects non FetchError", isStartupProbeTimeout(generic) === false);
+  const src = fs.readFileSync("src/browshManager.ts", "utf8");
+  check("waitForReady uses configured probe timeout", src.includes("timeout: this.healthProbeTimeoutMs"));
+  check("hardcoded 800ms probe is gone", !src.includes("timeout: 800"));
+  const budgets = resolveRenderTimeouts({} as NodeJS.ProcessEnv);
+  check("probe stays below startup budget", budgets.probe < budgets.startup, `probe ${budgets.probe} startup ${budgets.startup}`);
+}
+
 async function main(): Promise<void> {
   await testRenderQueue();
   testBudget();
   testLadder();
+  testStartupProbeGuard();
   testBreaker();
 
   console.log("");
```
<!-- END_GIT_DIFF -->
