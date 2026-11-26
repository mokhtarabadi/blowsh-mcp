# Task 272: Prevent WebRTC IP leaks through the configured proxy

**File:** `tasks/completed/272-prevent-webrtc-ip-leaks.md`
**Source:** manager
**Type:** bug
**Status:** closed
**Finished:** 2026-11-26T06:10:54Z
**Submitted:** 2026-11-26T00:38:04Z
**Started:** 2026-11-26T00:15:41Z
**Depends on:** [266]

## Source Context

### Variant C: Manager

## Goal

Prevent Firefox WebRTC from exposing the host or local network IP when Browsh runs behind an upstream proxy, while preserving proxy operation and local browser control traffic.

## Manager's Notes

- Observed on `https://browserleaks.com/ip` through the proxied Browsh singleton: HTTP egress showed a WARP IP, but WebRTC exposed the VPS public IP `194.76.154.73`.
- Track the fix in the `blowsh-mcp` source repository rather than the Headquarters repository.
- Keep the existing six-variable `PROXY_*` contract backward compatible.
- Inspect and update the sibling `src/README.md` and `src/DECISIONS.md` because the Firefox profile security contract changes.

## Relevant Code Context

- `src/proxyConfig.ts:121` builds the deterministic Firefox `user.js` proxy preferences.
- `src/proxyConfig.ts:155` writes that file before browser startup.
- `src/browshManager.ts` owns the persistent Browsh/Firefox profile lifecycle.
- `tests/proxy-config-tests.ts` covers proxy preference generation without a browser or network.
- `README.md:304` documents proxy support and persistent-profile caveats.
- `.env.example:106` documents the proxy configuration surface.

## Decision Log

**[2026-11-26] [D1] [EXECUTOR-DETECTED]:** Create a source-repository bug task for the observed WebRTC leak.

- **Rationale:** The leak is caused by the browser profile contract owned by `blowsh-mcp`, not by the Headquarters runtime configuration.
- **Alternatives considered:** A one-off production profile edit was rejected because it is not reproducible, testable, or preserved across deployments.
- **Impact:** The task stays in `tasks/backlog/` until the normal planning and approval gates authorize implementation.

## Local TODOs

- [x] Reproduce the WebRTC leak in a Dockerized proxied Browsh profile
- [x] Add deterministic Firefox preferences that prevent public and local WebRTC address exposure
- [x] Cover direct, HTTP proxy, and SOCKS5 preference generation with regression tests
- [x] Verify a fresh profile and a reused profile through BrowserLeaks or an equivalent WebRTC probe
- [x] Update proxy documentation, sibling folder docs, and the changelog
- [x] Run the strict TypeScript build, proxy regression suite, Docker build, and live browser verification

## Acceptance Criteria

- [x] Every generated Firefox profile disables WebRTC from exposing the host public IP and local/private interface addresses.
- [x] The policy applies consistently to direct mode, HTTP proxy mode, and SOCKS5 mode.
- [x] Existing proxy routing and the `127.0.0.1:4333` Browsh control-channel bypass remain functional.
- [x] A fresh Docker profile passes a BrowserLeaks WebRTC check without revealing the VPS public IP or local addresses.
- [x] A restarted container using the same profile volume keeps WebRTC disabled.
- [x] Any opt-out or override is explicit, documented, secure by default, and covered by tests.
- [x] `src/README.md`, `src/DECISIONS.md`, `README.md`, `.env.example`, and `CHANGELOG.md` reflect the final behavior.

## Verification Evidence

- **Leak precondition command:** `rtk test docker exec blowsh-singleton cat /data/browsh-profile/.config/browsh/firefox_profile/user.js`
- **Expected result:** current generated profile contains proxy preferences but no WebRTC policy.
- **Actual result:** file contains `network.proxy.*` only; `media.peerconnection` count is 0.
- **Exit code:** 0

- **Leak precondition command:** `rtk test docker exec blowsh-singleton sh -c 'grep -c media.peerconnection /data/browsh-profile/.config/browsh/firefox_profile/user.js || echo 0'`
- **Expected result:** 0 before hardening.
- **Actual result:** 0.
- **Exit code:** 0

- **Live reproduction command:** `tools.blowsh.fetch_web({ url: "https://browserleaks.com/ip", type: "plain", tier: "2", wait_ms: 5000, max_chars: 20000, deadline_ms: 120000 })`
- **Expected result:** record the pre-fix WebRTC exposure.
- **Actual result:** HTTP egress showed `104.28.243.187`, while the WebRTC section exposed host public IP `194.76.154.73`; local IP was `n/a`.
- **Exit code:** 0

- **Proxy precondition command:** `rtk test docker exec blowsh-singleton sh -c 'env | grep -i PROXY | sort'`
- **Expected result:** HTTP proxy remains configured and loopbacks remain bypassed.
- **Actual result:** `PROXY_TYPE=http`, `PROXY_HOST=100.74.8.111`, `PROXY_PORT=7890`, `PROXY_BYPASS=localhost,127.0.0.1`.
- **Exit code:** 0

- **Control-channel precondition command:** `rtk test docker exec blowsh-singleton node -e "fetch('http://127.0.0.1:4333/').then(r=>console.log('control-channel status '+r.status)).catch(e=>console.log('control-channel check '+e.message))"`
- **Expected result:** local Browsh control channel answers directly.
- **Actual result:** `control-channel status 200`.
- **Exit code:** 0

- **Test command:** `rtk test npx tsx tests/proxy-config-tests.ts`
- **Expected result:** RED confirmation after adding WebRTC policy tests, before implementation.
- **Actual result:** Exit 1 with 17/22 passing. T10-T14 failed because generated `user.js` lacks `media.peerconnection.enabled=false`. Full diagnostic retrieved with `rtk recall 69c2be30a59bd98d`.
- **Exit code:** 1

- **Test command:** `rtk test npx tsx tests/proxy-config-tests.ts`
- **Expected result:** All proxy preference checks pass, including WebRTC hardening assertions for every proxy mode and stale-profile overwrite behavior.
- **Actual result:** 22/22 checks passed after updating the direct-mode stale-profile expectation to include the new hardening block.
- **Exit code:** 0

- **Build command:** `rtk test npm run build`
- **Expected result:** Strict TypeScript compilation exits 0.
- **Actual result:** `tsc` completed with no errors.
- **Exit code:** 0

- **Docker build command:** `rtk test docker build -t blowsh-mcp:webrtc-leak-test .`
- **Expected result:** The runtime image builds successfully with the hardened profile policy.
- **Actual result:** Docker image built successfully.
- **Exit code:** 0

- **Container preference command:** `rtk test docker run --rm -e PROXY_TYPE=http -e PROXY_HOST=proxy.example.com -e PROXY_PORT=8080 blowsh-mcp:webrtc-leak-test node -e "import('./dist/proxyConfig.js').then(m=>{console.log(m.buildFirefoxUserJs(m.resolveProxyConfig(process.env)))})"`
- **Expected result:** HTTP mode contains proxy routing, loopback bypass, and all three WebRTC hardening preferences.
- **Actual result:** generated `user.js` contains `network.proxy.*`, `localhost, 127.0.0.1`, and the three `media.peerconnection.*` preferences.
- **Exit code:** 0

- **Live browser command:** `rtk test docker run --rm -e PROXY_TYPE=http -e PROXY_HOST=100.74.8.111 -e PROXY_PORT=7890 -e PROXY_BYPASS=localhost,127.0.0.1 -v <fresh-volume>:/data/browsh-profile -v /tmp/verify-272-webrtc.mjs:/app/verify-272-webrtc.mjs:ro blowsh-mcp:webrtc-leak-test node /app/verify-272-webrtc.mjs`
- **Expected result:** WebRTC public and local IP fields do not reveal the host public IP or private interface addresses, while normal HTTP egress still uses the configured proxy.
- **Actual result:** `{"pass":true,"httpEgressIp":"104.28.243.187","hostPublicIpExposed":false,"privateIpExposed":false,"controlChannelStatus":200,"userJsHardened":true}`.
- **Exit code:** 0

- **Reused-profile command:** repeated the same Docker live command with the same named volume and no manual reset.
- **Expected result:** restarted browser keeps WebRTC disabled and proxy routing intact.
- **Actual result:** identical passing JSON result on the reused profile.
- **Exit code:** 0

- **Full offline gate:** `rtk test npm run build` and all 11 `rtk test npx tsx tests/*.ts` suites exited 0 after the final code edit.
- **Final fresh gate:** repeated `rtk test npm run build` and `rtk test npx tsx tests/proxy-config-tests.ts` after documentation updates. Both exited 0.
- **Closure build gate:** `rtk test npm run build` exited 0 immediately before closure.
- **Task lint:** `lint_task_file` passed for `tasks/in-progress/272-prevent-webrtc-ip-leaks.md`.
- **Markdown lint:** task, `src/README.md`, `src/DECISIONS.md`, and root `README.md` passed. `CHANGELOG.md` retains pre-existing heading-spacing warnings outside this change; no Markdown linter is configured and `git diff --check` passed.
- **Environment contract:** `.env.example` adds no knob and preserves the six-variable `PROXY_*` contract; its comment now documents the always-on WebRTC hardening.

> Verification runner rule: each test-suite command above is the complete underlying command. The first verification run MUST use the `rtk test` prefix. A raw rerun is allowed only after a failed RTK run for detailed diagnostics.

## Definition of Done

The task is NOT done unless ALL of the following are true:

- [x] Build, regression tests, Docker build, and live browser verification pass with exit code 0
- [x] `lint_task_file` passes on the active task file
- [x] `CHANGELOG.md` updated via Parse-Then-Append
- [x] `testing-verification` applied and evidence recorded
- [x] Sibling living-folder documentation and ADR are updated
- [x] QA and code review pass before Manager-authorized closure

> Box-checking mandate: during implementation, check every Acceptance Criteria and Definition of Done box that is genuinely satisfied by recorded Verification Evidence.

## Risk & Rollback

- **Risk:** Overly restrictive WebRTC settings could break sites that require real-time media, and stale `prefs.js` state could override the generated policy on reused profiles.
- **Rollback plan:** Remove the WebRTC preference block and its tests, rebuild the image, and reset the affected profile volume if old Firefox state must be discarded.

---

## Execution Log & Reasoning

- Manager requested a tracked fix for the WebRTC public-IP leak observed through the proxied Browsh singleton.
- Repository inspection confirmed that Firefox preferences are generated centrally in `src/proxyConfig.ts` and written before every Browsh spawn.
- Mode lock: AUTOMATIC (autopilot) for both backlog tasks, requested by the Manager.
- Input normalization: `sesssion` corrected to `session`.
- Assumption A1: execute the Wayback rescue first, then the WebRTC hardening, because the Manager named both without specifying order.
- Discovery recovery: both delegated scans returned idle without reports, so the executor verified the context map directly.
- Brain plan verdict: `REPORT` containing an integrated plan for both backlog fixes.
- Brainstorm: not required — both fixes are reversible bug fixes with no schema change or irreversible deployment.
- Plan artifact: `tasks/.sessions/ses_deafc52f0ffeni6fm59dFdc7pP_7dda7a6b/brain_outputs/resp_6b0774ad3427f9b90225449d_6071671f5a304abc9fc1e50a98338e0d.json`.
- Approval status: Manager selected `Approve plan` for the integrated plan.
- Predecessor status: Wayback task closed after QA, technical review, and explicit Manager approval.
- Claim status: moved to `tasks/in-progress/` by `claim_next`.
- Header repair: `claim_next` left a stale `**File:**` path, so the executor corrected it.
- Implementation: added a shared WebRTC hardening block to every generated Firefox `user.js`, covering direct, HTTP, and SOCKS5 modes without changing the six-variable proxy contract.
- Verification: reproduced the original public-IP leak, confirmed RED failures, passed 22 proxy checks, strict tsc, all 11 offline suites, Docker build, and fresh plus reused-profile BrowserLeaks checks.
- Live result: HTTP egress remained `104.28.243.187`, WebRTC exposed neither `194.76.154.73` nor private addresses, and the local control channel returned 200.
- Documentation: updated `src/README.md`, `src/DECISIONS.md`, `README.md`, `.env.example` comments, and `CHANGELOG.md`.
- Stack gate skip record: repo root `/home/mohammad/blowsh-mcp`; marker scan `package.json, tsconfig.json, src/ports/`; matched stack skills none; reason `no stack-specific blueprint matches this Node MCP server, so strict tsc is the gatekeeper`.
- Next action: run final task/doc lint and transition to QA.
- QA transition: task moved to `tasks/qa/` and the staged diff was injected atomically.
- QA verdict: `QA_PASSED`. No blocking findings. All proxy modes, stale-profile overwrite, routing, control-channel bypass, credential safety, and live fresh/reused-profile evidence passed.
- QA artifact: `tasks/.sessions/ses_deafc52f0ffeni6fm59dFdc7pP_7dda7a6b/brain_outputs/resp_6b077f95c266f0fde44f46fa_f275363d18204e6a9b486431176a8f0a.json`.
- Code Reviewer verdict: `PO_REVIEW_PENDING`. Technically approved with no blocking defects. Final closure still requires explicit Manager approval.
- Reviewer artifact: `tasks/.sessions/ses_deafc52f0ffeni6fm59dFdc7pP_7dda7a6b/brain_outputs/resp_6b077fc5036715644be34ff1_60810e4b3c4d4ca889295600bffbf356.json`.
- Manager closure approval (verbatim answer value): `Approved for closure`.
- Next action: request the single Senior Programmer closure XML and execute it once.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `a92af35cf5a351293e601a48690188bd51ec687a`
<!-- END_GIT_DIFF -->
