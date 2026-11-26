# Milestone 6 Summary

**Date:** 2026-11-26
**Tasks Compacted:** 2
**Range:** v2.9.1 release → v2.9.2 release (Wayback rescue reliability and WebRTC IP-leak prevention)

## Source Distribution

| Source | Count |
| ------ | ----- |
| manager | 2 |

## Architectural Changes

- Wayback rescue now distinguishes availability API failures from genuine misses. Error-bearing payloads return `api-error`, the availability request is retried once, and an SSRF-guarded CDX query with `filter=statuscode:200&limit=1` supplies a reliable fallback. `archive="only"` keeps `archive.stale` for true misses, `archive="auto"` keeps original-error rethrow, `deadline.hit` remains rescue-ineligible, and empty-extraction failures are now rescue-eligible.
- Firefox WebRTC is hardened in every generated profile. Direct, HTTP proxy, and SOCKS5 modes append `media.peerconnection.enabled=false`, `media.peerconnection.ice.proxy_only=true`, and `media.peerconnection.ice.no_host=true`. The six-variable `PROXY_*` contract, proxy routing, loopback bypass, and every-boot `user.js` overwrite remain unchanged.
- Release v2.9.2 is a patch bump across `package.json`, `package-lock.json`, `src/server.ts`, `AGENTS.md`, and `docs/architecture.md`. The two fixes move from `[Unreleased]` into the dated `[2.9.2]` changelog section. GitHub milestone `v2.9.2` was created as milestone 3.

## Files Modified

| File | Change |
| --- | --- |
| `src/tools/fetchWeb.ts` | Error-first availability classification, CDX parser and lookup, one retry, snapshot download reuse, empty-extraction rescue eligibility |
| `tests/task10-stress-fixes.ts` | Wayback classifier, CDX, retry-contract, and empty-extraction regression coverage (31 checks) |
| `src/proxyConfig.ts` | Shared WebRTC hardening block appended in direct, HTTP, and SOCKS5 modes |
| `tests/proxy-config-tests.ts` | WebRTC mode coverage, stale-profile overwrite, and credential-safety checks (22 checks) |
| `docs/data_model.md` | Wayback retry and CDX fallback contract |
| `docs/architecture.md` | Wayback CDX integration plus v2.9.2 version references |
| `src/tools/README.md`, `src/tools/DECISIONS.md` | Wayback rescue contract and dated ADR |
| `src/README.md`, `src/DECISIONS.md` | WebRTC profile-security contract and dated ADR |
| `README.md`, `.env.example` | Proxy/WebRTC behavior and no-new-knob documentation |
| `CHANGELOG.md` | Two fix entries moved under `[2.9.2] - 2026-11-26` |
| `package.json`, `package-lock.json` | Version 2.9.1 → 2.9.2 |
| `src/server.ts`, `AGENTS.md` | Reported/current version 2.9.2 |
| `docs/history/milestone-6-summary.md` | Dense archive summary for the completed work |

## Criteria Met

| Task | Acceptance Criteria | Status |
| --- | --- | --- |
| 266 | Availability errors classified correctly; one retry then CDX; Yahoo archive rescue works; true misses keep `archive.stale`; auto rescue keeps original-error rethrow; all suites and Docker live checks pass | ✅ Met |
| 272 | WebRTC hardened in direct/HTTP/SOCKS5; proxy routing and loopback control preserved; fresh and reused Docker profiles expose no host public/private IP; docs and changelog synced | ✅ Met |

## Individual Task Summaries

### Task 266: Wayback archive rescue silently fails when the availability API times out

- **Type:** bug
- **Source:** manager
- **Reasoning:** The availability API returned HTTP 200 with an `error` object and empty snapshots for popular URLs, which the classifier collapsed into `no-snapshot`. The fix makes classification error-first, retries once, then uses CDX with a successful-status filter. Snapshot download and body validation are shared, SSRF checks cover every outbound archive URL, and empty-extraction failures qualify for rescue. Verified with 31 focused checks, all offline suites, Docker image build, CDX proof, and live archive-only/auto cases.

### Task 272: Prevent WebRTC IP leaks through the configured proxy

- **Type:** bug
- **Source:** manager
- **Reasoning:** BrowserLeaks showed HTTP egress through the proxy while WebRTC exposed the VPS public IP. The fix appends the same three WebRTC hardening preferences to every generated `user.js`, keeps the existing six-variable proxy contract and loopback bypass, and relies on the established every-boot overwrite instead of editing `prefs.js`. Verified with 22 proxy checks, strict tsc, all offline suites, Docker build, and fresh plus reused-profile BrowserLeaks probes showing no host public or private address exposure.

## Release Verification

- `rtk test npm run build` exited 0 at version 2.9.2.
- All 11 `tests/*.ts` suites exited 0, including 31 Wayback checks and 22 proxy/WebRTC checks.
- `rtk test docker build -t blowsh-mcp:2.9.2-test .` exited 0.
- Container metadata and compiled server both reported version 2.9.2.
- `rtk test bash /tmp/blowsh-release-smoke.sh` exited 0 after MCP initialize, tools/list, `fetch_web` registration, and version verification over HTTP transport.
- `git diff --check` passed. Version metadata is consistent across `package.json`, `package-lock.json`, and `src/server.ts`.
- Release publishing remains Manager-owned under ZAC. No commit, push, tag, or GitHub release was created by the agent.

## Stale Memory Report

No stale or superseded project-memory entries were found for release, archive, Wayback, CDX, WebRTC, proxy, or `user.js` topics.
