# Milestone 3 Summary

**Date:** 2026-11-20
**Tasks Compacted:** 2
**Range:** v2.7.0 release → v2.8.0 release (Browsh crash-storm containment and env-driven Docker proxy configuration)

## Source Distribution

| Source | Count |
| ------ | ----- |
| manager | 2 |

## Architectural Changes

- Crash-storm containment: `BrowshManager` observes the child's `exit`/`error` events directly, so an unexpected exit clears process state immediately (Node's `ChildProcess.killed` stays false when a child dies on its own) and re-arms boot prewarm; intentional recycle/idle/shutdown teardown is excluded because it nulls the process reference before killing. `isRunning` also checks `exitCode`/`signalCode`.
- Pure `CrashCircuit` (3 unexpected exits in 60 s → 30 s cooldown) rejects new renders before they queue. The suspect Firefox profile is quarantined to `<dir>.corrupt-<ts>` only on a true in-window storm (`stormPending`, set when `record` opens the circuit) using the configured `BROWSH_CRASH_THRESHOLD`, not a lifetime counter.
- Queue fan-out cut: `query_variants` run sequentially, so peak queued renders scale with one query instead of three; enrichment sheds itself when `browshManager.queuePressure` reports load. A global budget firing between queries now throws `createDeadlineError` instead of merging a partial or bare empty success.
- The four-budget timeout ladder is deliberately unchanged (ADR 2026-11-13); fail-fast comes from the crash circuit, not from shorter budgets.
- Env-driven proxy: six `PROXY_*` knobs (`TYPE`, `HOST`, `PORT`, `USERNAME`, `PASSWORD`, `BYPASS`) form one `.env` contract in the new `src/proxyConfig.ts`. `applyProxyEnv` seeds `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` for axios and `ensureFirefoxProxyPrefs` writes `network.proxy.*` into `user.js` before every Browsh spawn, because Firefox ignores proxy environment variables.
- Direct mode writes only `network.proxy.type=0` to defeat stale volume state, and `localhost`/`127.0.0.1` are always bypassed so the `127.0.0.1:4333` control channel stays direct. The SSRF guard, render queue, and timeout ladder are untouched.
- Proxy input hardening: strict decimal port parsing, auth colon omitted when the password is empty, and both `NO_PROXY` casings merged into the inherited bypass source. SOCKS5 is applied to browser renders only; the installed axios HTTP adapter has no SOCKS agent.

## Files Modified

| File | Change |
| ---- | ------ |
| src/browshManager.ts | Child exit/error listeners, `CrashCircuit`, storm-scoped profile quarantine, `isRunning`, `queuePressure` |
| src/tools/searchWeb.ts | Sequential variants, pressure-aware enrichment, global-deadline propagation |
| src/proxyConfig.ts | New env-to-proxy resolver, Firefox `user.js` generation, axios env seeding |
| src/server.ts | `applyProxyEnv` at startup; version bump to 2.8.0 |
| .env.example | Crash-circuit and proxy knobs documented |
| README.md | Docker host-proxy reachability and worked recipes |
| src/README.md, src/DECISIONS.md | Proxy module row and dated ADRs |
| src/tools/README.md, src/tools/DECISIONS.md | Fan-out and ADR records |
| tests/browser-crash-circuit-tests.ts | 29 checks, no browser and no network |
| tests/proxy-config-tests.ts | 17 checks, no browser and no network |
| CHANGELOG.md | 2.8.0 entries moved out of `[Unreleased]` |
| package.json, package-lock.json | Version 2.8.0 |
| docs/architecture.md, AGENTS.md | Version 2.8.0 |

## Criteria Met

| Task | Acceptance Criteria | Status |
| ---- | ------------------- | ------ |
| 267 | Unexpected exit flips `isRunning`; three crashes open the circuit; teardown never counts; profile quarantined after a storm; variants sequential; enrichment sheds; ladder unchanged; build and all suites exit 0; live probe inside deadline | ✅ Met |
| 268 | Proxy knobs configurable from `.env`; Firefox and axios follow the proxy; loopback bypass; SSRF/queue/ladder unchanged; Docker docs present; build and container smoke pass | ✅ Met |

## Individual Task Summaries

### Task 267: Browsh crash storm collapses the single render slot and times out searches

- **Type:** bug
- **Source:** manager
- **Reasoning:** Root cause was a crashing Browsh child behind one FIFO mutex plus parallel variant fan-out, not a too-short budget. The fix observes child exits, opens a crash circuit, quarantines the profile only on a true storm, and runs variants sequentially while keeping the ADR timeout ladder. Verified with 29 circuit checks, 42 ladder checks, eight pre-existing suites, and a live search at 28,564 ms.

### Task 268: Env-driven proxy configuration for Docker deployments

- **Type:** feature
- **Source:** manager
- **Reasoning:** Firefox ignores proxy environment variables and the profile lives on a Docker volume, so preferences are generated before every spawn. axios already honors proxy environment variables through `proxy-from-env`. Six `PROXY_*` knobs, a deterministic direct mode, an unconditional loopback bypass, Docker recipes, and 17 browser-free checks with container smoke tests.
