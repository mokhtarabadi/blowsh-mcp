# Task 268: Env-driven proxy configuration for Docker deployments

**File:** `tasks/completed/268-env-driven-proxy-configuration.md`
**Source:** manager
**Type:** feature
**Status:** closed
**Finished:** 2026-11-18T17:34:24Z
**Submitted:** 2026-11-18T17:14:14Z
**Started:** 2026-11-18T17:03:23Z
**Mode:** AUTOMATIC (autopilot locked)
**Session:** $OPENCODE_SESSION_ID

## Goal

Make upstream proxy configuration fully environment-driven so an operator who runs this MCP server in Docker can route both Firefox/Browsh renders and Node-side axios egress through an HTTP or SOCKS proxy, with configurable proxy type, credentials, and bypass list, and with documentation that explains the Docker networking requirements.

## Manager's Notes

- Proxy settings, `no_proxy`, proxy type, and everything else needed MUST be settable from `.env`.
- The consumer runs the MCP server in Docker and must be able to use a proxy without rebuilding the image.
- If the proxy runs on the host, the operator must pass the Docker host address or use host networking. Documentation MUST explain this and show how.
- Explain all prerequisites and the exact setup steps so a consumer knows what is required.
- Pay attention to the fact that the deployment is inside Docker.
- Autopilot mode is locked for this task. Plan approval and closure approval remain hard gates.

## Pinned Context — `[fed-context]`

Verified read-only discovery, 2026-11-18. All citations are from the live worktree.

- `src/browshManager.ts:469-475` — Browsh is spawned with only `--http-server-mode` and optional `--firefox.path`; no proxy/profile argument exists.
- `src/browshManager.ts:482-494` — `spawn("browsh", args, { stdio, detached: true, env: { ...process.env, HOME: this.profileDir, COLUMNS, LINES } })`. The whole environment is inherited by the child.
- `src/browshManager.ts:369` — `this.profileDir = process.env.BROWSH_PROFILE_DIR || "/data/browsh-profile"`.
- `src/browshManager.ts:411-417` — the profile directory is created before spawn; `:844-866` quarantines a corrupt profile by rename.
- `src/browshManager.ts:534-547` — readiness probe on `http://127.0.0.1:4333/`; `:631-637` — every render is handed to Browsh through `axios.get(http://127.0.0.1:4333/<url>)`.
- `src/browshManager.ts:703-730` — teardown kills the detached process group, so Firefox never orphans and holds the profile lock.
- `Dockerfile:28` — `ENV BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr`; `:33` — `ENV BROWSH_PROFILE_DIR=/data/browsh-profile`; `:41` — `firefox-esr` installed; `:42` — Browsh pinned to v1.8.0; `:61` — `VOLUME /data/browsh-profile`; `:71` — `CMD ["node", "dist/server.js"]`.
- `.env.example:1-100` — no proxy variable of any kind exists today; `docs/conventions.md:105` requires every new knob to be documented in `.env.example` and `README.md`.
- `src/ssrf.ts:6,53` — `ALLOW_PRIVATE_URLS` is the only network knob and short-circuits the guard when true. Do not alter this semantics.
- `src/server.ts:22` — `dotenv.config({ quiet: true })` loads `.env` into `process.env` before any tool runs.
- `node_modules/axios/lib/adapters/http.js:5` imports `proxy-from-env`; `node_modules/proxy-from-env/index.js:60-64` proxies everything when `NO_PROXY` is unset, including `127.0.0.1`.
- `node_modules/proxy-from-env/index.js:44` uses `<scheme>_proxy` and `all_proxy` env keys; axios therefore honors `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` with no code change.
- Upstream Browsh v1.8.0 `interfacer/src/browsh/firefox.go` — `setDefaultFirefoxPreferences()` reads `viper.GetStringSlice("firefox.preferences")` and applies each as an `about:config` value through Marionette. String values must be quoted; integers unquoted.
- Upstream Browsh v1.8.0 `interfacer/src/browsh/comms.go` — `webSocketServer()` calls `setDefaultFirefoxPreferences()` before sending the first `/new_tab`.
- Upstream Browsh v1.8.0 `interfacer/src/browsh/config.go` — Viper loads `config.toml` and bound pflags; there is no `AutomaticEnv`, so env vars cannot set `firefox.preferences` directly.
- browsh-org/browsh issue #201 (comment 2024-02-06) — proxy can be set in the Browsh Firefox profile with `$HOME/.config/browsh/firefox_profile/user.js` using `network.proxy.*` preferences; `network.proxy.type=1` is manual.
- Playwright issue #6094 — Firefox does not consume `HTTP_PROXY`/`HTTPS_PROXY` env vars by default, unlike Chromium. Browser proxy requires explicit prefs.
- `src/README.md:10,17` and `src/tools/README.md:3` — every outbound URL must pass `assertSafeUrl`; a proxy must not bypass this guard.
- `src/DECISIONS.md:37-55` — teardown targets the whole process group; persistent profile reuses the redirected `HOME` and is never wiped.
- `docs/conventions.md:105` — single source of truth for config is `.env.example`, mirrored in `README.md`.
- Prior verdict: environment proxy alone covers only axios; Firefox needs profile prefs. A baked image config can be shadowed by the `/data/browsh-profile` volume.

## Local TODOs

- [ ] Design the env-var contract with the Brain plan and record it in the Decision Log
- [ ] Add proxy env knobs to `.env.example` and the `README.md` environment table
- [ ] Implement env-to-Firefox-preference generation before the Browsh spawn
- [x] Keep the Browsh loopback control channel and local Firefox sockets bypassed
- [x] Add tests for proxy pref generation, bypass handling, and the no-proxy reset path
- [x] Document Docker host-proxy reachability and worked `docker run` examples
- [x] Verify with tsc build, Docker build, and a container smoke test
- [x] Update CHANGELOG, sibling docs, and inject the diff; move to QA

## Acceptance Criteria

- [x] Proxy type, host, port, credentials, and bypass list are all configurable from `.env` with documented defaults.
- [x] Firefox/Browsh renders use the configured proxy; when no proxy is configured, direct mode is forced deterministically.
- [x] Node-side axios egress follows the same configuration without per-callsite edits.
- [x] `localhost`/`127.0.0.1` are always bypassed so the `127.0.0.1:4333` control channel and Marionette remain direct.
- [x] The SSRF guard, render queue, and timeout ladder are unchanged.
- [x] README explains Docker-specific requirements: host-gateway, `host.docker.internal`, host networking, and worked examples.
- [x] tsc build and container smoke test pass with exit code 0.

## Verification Evidence

- **Test command:** rtk test npx tsx tests/proxy-config-tests.ts
- **Expected result:** all proxy-config tests pass
- **Actual result:** 17/17 checks passed after the QA hotfix (T1–T9 across 14 assertions plus three HOTFIX checks for strict decimal ports, username-only auth URLs, and dual `NO_PROXY` casings). RED run before implementation failed with `ERR_MODULE_NOT_FOUND` for `src/proxyConfig.js`, confirming the test actually exercises the new module.
- **Exit code:** 0
- **Gate command:** npm run build
- **Gate expected:** tsc exits 0 with no errors
- **Gate actual:** `> blowsh-mcp@2.7.0 build` / `> tsc` with no diagnostics
- **Gate exit code:** 0
- **Container command:** docker build -t blowsh-mcp:proxy-268 .
- **Container actual:** multi-stage build completed; Browsh v1.8.0 and firefox-esr present in the runtime image
- **Container exit code:** 0
- **Smoke direct:** `docker run --rm -e PROXY_TYPE=none blowsh-mcp:proxy-268 ... cat /data/browsh-profile/.config/browsh/firefox_profile/user.js` → `user_pref("network.proxy.type", 0);` — exit 0
- **Smoke proxy:** `docker run --rm -e PROXY_TYPE=http -e PROXY_HOST=host.docker.internal -e PROXY_PORT=8080 -e PROXY_BYPASS=localhost,127.0.0.1 ...` → user.js with type 1, http/ssl host and port, share_proxy_settings, `no_proxies_on` = `localhost, 127.0.0.1` — exit 0
- **Smoke MCP:** piped `initialize` → `notifications/initialized` → `tools/list` over stdio; response contained `"fetch_web"` (grep count 1). Wrapper exit 124 is the deliberate `timeout 40` killing the long-lived stdio server after the response, not a server failure.
- **Whitespace gate:** `git diff --check` exit 0; `git status --short` shows only the nine intended source/doc files plus untracked new files.

> Verification runner rule: the first verification run MUST use the `rtk test` prefix. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

Strict Tooling Gate note: `node-hexagonal-api` was loaded for discipline only, per the implementation XML's binding fallback record. This repository has no ESLint, dependency-cruiser, knip, Vitest, or tsd configuration and `AGENTS.md` states "strict tsc is the gatekeeper (no linter)"; installing those tools is out of scope. The effective gate is therefore `npm run build`, the `rtk test` suite, `docker build`, and the container smoke tests above, all green. No format/lint/static-analysis/security tooling exists to run in this repo.

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional):

- [x] Build/Test/Lint pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded

## Risk & Rollback

- **Risk:** a proxy env var without a bypass list makes axios proxy the loopback Browsh control channel and breaks every render. **Mitigation:** always seed `NO_PROXY` with `localhost,127.0.0.1`.
- **Risk:** `/data/browsh-profile` is a volume; a config baked into the image can be shadowed by stale state. **Mitigation:** generate the prefs file before each spawn and write deterministic direct-mode prefs when no proxy is set.
- **Risk:** proxy credentials could leak through logs. **Mitigation:** never log pref values; keep credentials in env only.
- **Rollback plan:** remove the new env knobs and the pref-generation helper; delete the generated `user.js`; revert docs. The profile's `prefs.js` may retain prefs until the profile volume is reset, so document that reset step.

## Decision Log

**[2026-11-18] [D1] [ORCHESTRATOR-DETECTED]:** Six `PROXY_*` variables form one `.env` contract mapped to axios environment variables and Firefox `user.js`.
- **Rationale:** one source of truth for Docker operators, no image rebuild, Firefox ignores proxy environment variables.
- **Alternatives considered:** standard `HTTP_PROXY` only (Firefox stays direct); Browsh `config.toml` baked into the image (volume shadows it); transparent container proxy (outside repo control).
- **Impact:** deterministic proxy and direct modes, loopback safety, credential hygiene.

**[2026-11-18] [D2] [EXECUTION-DETECTED]:** `ensureFirefoxProxyPrefs` is also called on the post-quarantine retry path in `ensureStarted`, in addition to the initial boot path.
- **Rationale:** `quarantineProfileDir` renames the old profile and recreates the directory, so the retry would otherwise spawn Firefox without a `user.js`.
- **Alternatives considered:** moving the call into `spawnAndWait` (would change the approved call site).
- **Impact:** every spawn gets the configured prefs; the approved contract and file paths are unchanged.

**[2026-11-18] [D3] [EXECUTION-DETECTED]:** Strict Tooling Gate recorded as discipline-only for `node-hexagonal-api`.
- **Rationale:** the repository has no lint/static-analysis/test-runner configuration and `AGENTS.md` names strict tsc as the sole gatekeeper.
- **Alternatives considered:** installing ESLint 10, dependency-cruiser, knip, and Vitest (scope creep and dependency churn).
- **Impact:** verification uses tsc, `rtk test`, docker build, and container smoke; recorded in Verification Evidence.

**[2026-11-18] [D4] [EXECUTION-DETECTED]:** QA hotfix closes three reproducible input-handling defects in `src/proxyConfig.ts`.
- **Rationale:** QA reproduced that `Number()` accepted hex/exponent/float ports, that a username with no password produced `http://user:@host:port`, and that `NO_PROXY ?? no_proxy` discarded the lowercase value when both were set.
- **Alternatives considered:** disputing the findings; all three reproduced directly from the code and were fixed with strict decimal regex parsing, conditional auth colon, and merging both `NO_PROXY` casings.
- **Impact:** three regression checks added; 17/17 tests pass, tsc exits 0, `git diff --check` exits 0. SSRF guard, render queue, and timeout ladder remain untouched.

**[2026-11-18] [D5] [EXECUTION-DETECTED]:** Code Reviewer hygiene fix updates the CHANGELOG check count and task provenance path and removes an unused test array.
- **Rationale:** `APPROVED_WITH_CHANGES` cited three low-severity document and maintainability defects after the QA hotfix; all three reproduced from the attached diff.
- **Alternatives considered:** disputing the findings; each was an accurate stale reference or dead code with no behavior impact.
- **Impact:** `CHANGELOG.md` now states 17 checks and points at the `tasks/qa/` path; the unused `bad` array is removed while the rejection loop remains. No proxy logic, contract, or lane changed.

## Execution Log & Reasoning

Plan approved by the Manager through the question tool at the supervised autopilot gate; Brain routed to Senior Programmer and emitted the implementation XML. Task claimed from `tasks/backlog/` to `tasks/in-progress/` through `planner.claim_next`.

Assumption A1 (confirmed by Manager): proxy means routing outbound traffic through an upstream proxy. Assumption A2: docs-only discovery was superseded by the explicit request to implement and track in a task. Assumption A3: Browsh v1.8.0 is pinned in `Dockerfile:42`. Assumption A4: exact variable names were decided by the Brain plan (`PROXY_TYPE`, `PROXY_HOST`, `PROXY_PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD`, `PROXY_BYPASS`). Assumption A5: `applyProxyEnv` called from `src/server.ts` immediately after `dotenv.config()`.

Edits made: created `src/proxyConfig.ts` with `resolveProxyConfig`, `buildFirefoxUserJs`, `ensureFirefoxProxyPrefs`, and `applyProxyEnv`; wired startup resolution into `src/server.ts`; wired preference generation into both boot paths of `src/browshManager.ts`; created `tests/proxy-config-tests.ts`; documented all six knobs in `.env.example` and the `README.md` environment table; added a Docker proxy section with bridge and host-network recipes; added a module row and invariant note to `src/README.md`; appended a dated ADR to `src/DECISIONS.md`; appended an `### Added` entry under `[Unreleased]` in `CHANGELOG.md` via Parse-Then-Append.

Reasoning: Firefox is the actual egress for all browser renders and ignores proxy environment variables, so profile preferences are the only reliable lever. Because `BROWSH_PROFILE_DIR` is a volume, the preference file is overwritten on every boot and a direct-mode reset writes exactly one preference. axios already honors proxy environment variables through `proxy-from-env`, so no callsite changed; the loopback bypass is injected unconditionally to protect the `127.0.0.1:4333` control channel. SSRF guard, render queue, and timeout ladder were left untouched. Test ordering was RED then GREEN, and container smoke confirmed both generated preference files.

Open question for the Manager: SOCKS5 sets `socks5h://` for axios, but the installed axios HTTP adapter has no SOCKS agent. Browser renders are correctly SOCKS5-proxied; Node-side axios egress should use `PROXY_TYPE=http` unless a SOCKS agent is added in a follow-up. This is documented as a consequence in `src/DECISIONS.md`.

QA hotfix: the first review returned `QA_REJECTED` with three reproducible findings. `src/proxyConfig.ts` now uses `/^\d+$/` plus `parseInt` for ports, omits the auth colon when the password is empty, and merges both `NO_PROXY` and `no_proxy` into the inherited bypass source. `tests/proxy-config-tests.ts` gained three regression checks. No other file was touched by the hotfix, and the no-proxy/direct and Docker smoke evidence from the first pass remains valid because the hotfix changes only input parsing and env merging.

QA re-review returned `QA_PASSED`. Code Review first returned `APPROVED_WITH_CHANGES`, then `APPROVED` with `PO_REVIEW_PENDING` after the hygiene fix; technical approval is complete and final closure awaits the Manager's explicit word.

Code Review returned `APPROVED_WITH_CHANGES` with three low-severity hygiene items. `CHANGELOG.md` now reports 17 checks and links to the `tasks/qa/` path, and the unused `bad` array was removed from the port-rejection test while its assertion loop stayed intact. No proxy logic, contract, or lane changed. Sequential decision IDs were kept: D4 records the QA hotfix, D5 records this hygiene fix.

Closure approval: Manager answered the relayed closure question with the exact phrase "Approved for closure" on 2026-11-18. Preconditions verified before the closure turn: the task file was still in `tasks/qa/` and its log recorded `PO_REVIEW_PENDING`. The Brain emitted one final closure XML; no re-issuance was needed. This execution log records the accept quote and moves the task to `tasks/completed/` with status `closed` before the single MCP commit path.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `742ba539d8f1fdda03ee1f757bd2cdbdc5631a33`
<!-- END_GIT_DIFF -->
