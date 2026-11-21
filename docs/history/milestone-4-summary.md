# Milestone 4 Summary

**Date:** 2026-11-21
**Tasks Compacted:** 1
**Range:** v2.8.0 release → v2.9.0 release (startup health-probe timeout fix)

## Source Distribution

| Source | Count |
| ------ | ----- |
| manager | 1 |

## Architectural Changes

- The Browsh startup health check now has its own budget. `waitForReady` no longer uses a hardcoded 800 ms axios timeout against `/`, which re-renders Browsh's welcome page and takes roughly 0.9-2 s on this host. `DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5000` and `BROWSH_HEALTH_PROBE_TIMEOUT_MS` (clamped 1000-60000) join the existing render, queue, and startup budgets in `resolveRenderTimeouts`. The outer `BROWSH_STARTUP_TIMEOUT_MS` loop still bounds total startup time.
- Profile quarantine is no longer triggered by a pure probe timeout. `ensureStarted` now rethrows that specific `FetchError` unchanged; quarantine remains reserved for path and lock failures that actually justify a fresh Firefox profile.
- The quarantine guard was hardened after QA rejection. A shared `BROWSH_STARTUP_TIMEOUT_MESSAGE` constant and an exported `isStartupProbeTimeout` substring-match helper replace exact string equality, so an HTTP status suffix or wording change cannot silently restore quarantine of a healthy profile. Both throw sites use the shared constant.
- Residual operator risks documented, not fixed: the clamp floor of 1000 ms can reintroduce the false timeout if an operator overrides it, and a probe ceiling of 60000 ms can exceed a startup budget clamped to 10000 ms. Defaults stay safe at 5000 ms versus 120000 ms.

## Files Modified

| File | Change |
| ---- | ------ |
| src/browshManager.ts | Probe timeout budget, shared timeout message constant, `isStartupProbeTimeout` helper, quarantine guard |
| tests/search-timeout-hardening-tests.ts | Guard, wiring, clamp, and ladder regression checks (52 checks) |
| .env.example | `BROWSH_HEALTH_PROBE_TIMEOUT_MS` documented with band and slow-host note |
| README.md | Configuration table row for the new probe knob |
| src/DECISIONS.md | Dated ADR recording context, decision, alternatives, and rollback |
| CHANGELOG.md | Fix entry, then moved out of `[Unreleased]` into the 2.9.0 release header |

## Criteria Met

| Task | Acceptance Criteria | Status |
| ---- | ------------------- | ------ |
| 269 | Configurable probe timeout with 5000 ms default; pure probe timeout no longer quarantines; offline tests assert default and override; strict tsc exit 0; Docker `fetch_web` render succeeds; docs and CHANGELOG synced | ✅ Met |

## Individual Task Summaries

### Task 269: Fix the Browsh startup health probe timeout

- **Type:** bug
- **Source:** manager
- **Reasoning:** Root cause was a per-probe timeout shorter than one render of Browsh's welcome page, so startup failed with a false timeout while the endpoint answered HTTP 200. The fix gives the probe its own configurable budget and stops quarantining a healthy profile on that timeout. First QA pass rejected an exact-string guard with no guard or wiring tests; the hotfix added a shared constant, a substring-match helper, seven regression checks, and a lane-independent CHANGELOG reference. Re-audit returned QA_PASSED and Code Review returned PO_REVIEW_PENDING with no blocking defect. Verified with strict tsc, 52 timeout checks, 17 proxy checks, 29 crash checks, and a live Docker `fetch_web` render with `isError:false`.
