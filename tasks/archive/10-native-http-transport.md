# Task 10: Native streamable-HTTP transport (singleton mode)

**File:** `tasks/completed/10-native-http-transport.md`
**Source:** manager
**Type:** feature
**Status:** closed

## Goal

Run blowsh-mcp as one supervised HTTP instance (streamable HTTP on 127.0.0.1:8107) shared by all opencode sessions, instead of one stdio process per session.

## Manager's Notes

Manager verbatim 2026-09-29: "blowsh is our own project you can add support for http to it it located at ../blowsh-mcp". Part of HQ task 277 (MCP singleton rollout): 6 Python MCP servers already cut to `type: remote` singletons on ports 8101-8106; blowsh is the last one (port 8107). stdio stays the default; HTTP activates only via `MCP_TRANSPORT=http`.

## Local TODOs

- [ ] Refactor `runServer()` into `createServer()` factory + stdio path unchanged
- [ ] Add express streamable-HTTP path (`MCP_TRANSPORT=http`, `MCP_HOST`, `MCP_PORT`, default 127.0.0.1:8107)
- [ ] Add `express` dependency, `npm run build` clean under strict tsc
- [ ] Docker build + HTTP smoke test (initialize → tools/list) via container
- [ ] Update CHANGELOG.md, AGENTS.md, README/docs transport section
- [ ] Persistent container + HQ config cutover + 7/7 verification

## Acceptance Criteria

- [x] `MCP_TRANSPORT` unset keeps byte-identical stdio behavior
- [x] HTTP mode returns 200 initialize with blowsh-mcp capabilities and serves tools/list + tools/call
- [x] Server binds 127.0.0.1 only by default
- [x] Docker image builds and passes smoke test
- [x] Docs + CHANGELOG updated

## Verification Evidence

- **Build:** `npm run build` exit 0
- **Smoke:** containerized HTTP initialize + tools/list 200
- **Actual result:** `npm run build` re-verified 2026-09-29 exit 0; prior container smoke: health 200, initialize 200, tools/list 5/5 tools, SSE stream 200 + endpoint event, HQ `opencode mcp list` 7/7 connected with live search_web through singleton
- **Exit code:** 0

## Definition of Done

- [x] Build passes with exit code 0
- [x] Smoke test passes via Docker (per repo guardrails, no host Firefox)
- [x] CHANGELOG.md updated
- [x] Task lint clean (if applicable)

## Risk & Rollback

- **Risk:** refactor breaks stdio path; express adds a dependency
- **Rollback plan:** `git diff` revert of `src/server.ts` + `package.json`; stdio default untouched by design

---

## Execution Log & Reasoning

2026-09-29 — implemented + verified. `src/server.ts`: extracted `createServer()` factory (stdio path byte-identical), added `runHttpServer()` (express + `StreamableHTTPServerTransport` stateless, `POST /mcp`, 405 on GET/DELETE, `GET /health`); `MCP_TRANSPORT=http|streamable-http` selects it, `MCP_HOST`/`MCP_PORT` default 127.0.0.1:8107. Deps: `express@4.21.2` + `@types/express`. `npm run build` exit 0. Docker rebuild exit 0. Container smoke: health 200, initialize 200, tools/list returns all 5 tools. Key catch: inside Docker the server MUST bind `MCP_HOST=0.0.0.0` (container loopback unreachable from host); host side locked via `-p 127.0.0.1:8107:8107`. Persistent `blowsh-singleton` (`--restart unless-stopped`, `blowsh-profile` volume) up + healthy. HQ cutover: `mcp.blowsh` → `{type:remote, url:http://127.0.0.1:8107/mcp, timeout:30000}` (backup `opencode.json.bak-20260929-081116`); `opencode mcp list` 7/7 connected; live `search_web` call through singleton returned real results. Upstream note: opencode issue #8058 claims remote=SSE-only, but 2.0.19 empirically speaks streamable HTTP (evidence wins).

2026-09-29 — triple transport done. Added `runSseServer()` (`MCP_TRANSPORT=sse`, default 127.0.0.1:8108): stateful per-session transports on `GET /sse` + `POST /messages?sessionId=…` + `GET /health`; dispatch added in `runServer()`; stdio/http paths untouched. `npm run build` exit 0. Docker smoke: SSE stream 200 + endpoint event, initialize accepted, `tools/list` returns all 5 tools over the stream. Test container/image removed after verification. README env table + CHANGELOG [Unreleased] updated.

2026-09-29 — state check + autopilot lock. Git worktree: 7 modified files (AGENTS.md, CHANGELOG.md, Dockerfile, README.md, package-lock.json, package.json, src/server.ts) + 1 untracked task file, all matching Task 10 scope. Memory: checked `config-quirks` / `v211-bugfix-quirks`, no relevant constraints for HTTP transport. Re-verified `npm run build` exit 0 and task lint clean. All Local TODOs, AC (5/5), DoD (4/4) now checked with recorded evidence. Autopilot locked per Manager order; proceeding to stage_and_inject_diff → qa → Brain QA.
- [x] Refactor `runServer()` into `createServer()` factory + stdio path unchanged
- [x] Add express streamable-HTTP path
- [x] Add `express` dependency, `npm run build` clean under strict tsc
- [x] Docker build + HTTP smoke test via container
- [x] Update CHANGELOG.md, AGENTS.md, README transport section
- [x] Persistent container + HQ config cutover + 7/7 verification

2026-09-29 — Brain QA verdict QA_PASSED. Findings: stdio default preserved, HTTP stateless POST /mcp + 405 GET/DELETE + GET /health correct, default bind 127.0.0.1, SSRF guard and FetchError surface unchanged. Non-blocking hardening noted: R1 invalid MCP_PORT without validation, R2 SSE POST /messages missing try/catch, R3 Dockerfile exposes 8107 but not SSE 8108. Proceeding to Brain review.

2026-09-29 — Review postfix applied (APPROVED_WITH_CHANGES I1-I4). `src/server.ts`: added `resolvePort()` with integer 1-65535 check + fallback log, used in both HTTP (8107) and SSE (8108) runners; wrapped SSE `GET /sse` connect and `POST /messages` in try/catch with safe 500 JSON. `Dockerfile`: `EXPOSE 8107 8108` with dual-mode comment. `.env.example`: documented `MCP_HOST`/`MCP_PORT` with Docker loopback note. `docs/architecture.md` section 6: stdio default + optional singleton HTTP/SSE note. `CHANGELOG.md` Unreleased Fixed line added. Route logic, SSRF guard, FetchError mapping, stdio path untouched.

2026-09-29 — Brain re-review: APPROVED, PO_REVIEW_PENDING. All I1-I4 closed, no stdio/SSRF/FetchError regression. Awaiting Manager explicit closure phrase.

2026-09-29 — closure approved by Manager ("Approved for closure"), moving to completed with no code changes.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `ac55acc114c360f59ce74d004cf6b5c9b7e591a2`
<!-- END_GIT_DIFF -->
