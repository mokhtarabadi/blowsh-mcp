# Task 272: Prevent WebRTC IP leaks through the configured proxy

**File:** `tasks/qa/272-prevent-webrtc-ip-leaks.md`
**Source:** manager
**Type:** bug
**Status:** in-progress
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
- [ ] QA and code review pass before Manager-authorized closure

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

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/.env.example b/.env.example
index f0cf0a1..82a204b 100644
--- a/.env.example
+++ b/.env.example
@@ -106,8 +106,8 @@ ENRICH_BUDGET_MS=180000
 # Upstream proxy (Docker-friendly)
 # -------------------------------
 # All six knobs are read from .env at startup. PROXY_TYPE=none is the default
-# and writes a deterministic direct-mode Firefox preference, so a stale
-# user.js on a persistent /data/browsh-profile volume cannot keep a proxy on.
+# and writes a deterministic direct-mode Firefox preference. Every mode also
+# appends secure WebRTC hardening to user.js, so no additional knob is required.
 # PROXY_TYPE: none | http | socks5. Any other value aborts startup.
 PROXY_TYPE=none
 # Hostname or IP only: no scheme, path, port, or credentials. Required when
diff --git a/CHANGELOG.md b/CHANGELOG.md
index b002213..f2590e8 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -5,6 +5,7 @@
 ### Fixed
 
 - Wayback archive rescue no longer treats the availability API's transient timeout payload as a genuine miss. `classifyWaybackAvailability` now returns `api-error` for error-bearing payloads, `fetchWaybackOutcome` retries once, then queries CDX with `filter=statuscode:200&limit=1`. `archive: "only"` still throws `archive.stale` only on a true miss, `archive: "auto"` still rethrows the original live error when no snapshot exists, and `deadline.hit` remains rescue-ineligible. Empty-extraction failures now qualify for archive rescue. Regression coverage in `tests/task10-stress-fixes.ts` (31 checks). See Task 266.
+- Firefox WebRTC no longer exposes host public or local/private IPs through Browsh. Every generated `user.js` now appends `media.peerconnection.enabled=false`, `media.peerconnection.ice.proxy_only=true`, and `media.peerconnection.ice.no_host=true` in direct, HTTP, and SOCKS5 modes. The six `PROXY_*` variables, proxy routing, loopback bypass, and every-boot profile overwrite remain unchanged. Regression coverage in `tests/proxy-config-tests.ts` (22 checks). See Task 272.
 
 ## [2.9.1] - 2026-11-25
 
diff --git a/README.md b/README.md
index 51ab620..a693186 100644
--- a/README.md
+++ b/README.md
@@ -310,8 +310,9 @@ Firefox ignores those environment variables, so the server writes
 `<BROWSH_PROFILE_DIR>/.config/browsh/firefox_profile/user.js` before every
 Browsh spawn. With the default profile root that is
 `/data/browsh-profile/.config/browsh/firefox_profile/user.js`. The file is
-rewritten on every boot; when `PROXY_TYPE=none` it contains only
-`network.proxy.type=0`, so a stale proxy on a reused volume cannot survive.
+rewritten on every boot; when `PROXY_TYPE=none` it contains
+`network.proxy.type=0` plus the WebRTC hardening block, so a stale proxy on a
+reused volume cannot survive and WebRTC cannot expose host addresses.
 
 Prerequisites:
 
@@ -360,7 +361,8 @@ Or put the same keys in `.env` and use `--env-file .env` instead of repeated
 and restart; the server overwrites `user.js` automatically. If Firefox still
 uses the old proxy, reset the profile volume (for example
 `docker volume rm blowsh-profile`) because `prefs.js` can retain values from an
-earlier session.
+earlier session. The same volume reset clears stale WebRTC policy; `user.js` is
+overwritten automatically on restart.
 
 ---
 
diff --git a/src/DECISIONS.md b/src/DECISIONS.md
index d7229e2..f352ece 100644
--- a/src/DECISIONS.md
+++ b/src/DECISIONS.md
@@ -143,3 +143,15 @@ Sibling of `src/README.md`. Tool-level records live in `src/tools/DECISIONS.md`.
 **Consequences.** Orphan cleanup degrades safely on minimal containers: it never crashes the server and never deletes locks without a pgrep confirmation. The 2 s in-process wait blocks the event loop briefly during teardown.
 
 **Rollback.** Replace `waitMsSync` with `execFileSync("sleep", ["2"])` and remove the ENOENT guards.
+
+## 2026-11-26 — Prevent WebRTC IP leaks behind an upstream proxy
+
+**Context.** BrowserLeaks through the proxied Browsh singleton showed HTTP egress from the WARP address while the WebRTC section exposed the VPS public IP `194.76.154.73`. The generated Firefox `user.js` contained only `network.proxy.*` preferences, so Firefox WebRTC remained free to gather host candidates outside the proxy path.
+
+**Decision.** Append the same secure-by-default policy to every generated `user.js`: `media.peerconnection.enabled=false`, `media.peerconnection.ice.proxy_only=true`, and `media.peerconnection.ice.no_host=true`. Apply it in direct, HTTP, and SOCKS5 modes. Keep the six-variable `PROXY_*` contract unchanged, add no opt-out knob, preserve loopback bypass for the local control channel, and rely on the existing every-boot overwrite instead of editing `prefs.js`.
+
+**Alternatives rejected.** An opt-out environment knob was rejected because the leak is a security default and no supported use case requires WebRTC in this research browser. Direct `prefs.js` surgery was rejected because persistent profile state can shadow generated policy. A one-off production profile edit was rejected because it is not reproducible or preserved across deployments.
+
+**Consequences.** Firefox WebRTC cannot expose the host public IP or local/private interface addresses, while HTTP and SOCKS5 proxy routing plus the `127.0.0.1:4333` control channel remain intact. Sites that require real-time media lose WebRTC, which is the intended secure default for Browsh.
+
+**Rollback.** Remove the WebRTC preference block and its regression tests, rebuild the image, and reset the affected profile volume if old Firefox state must be discarded.
diff --git a/src/README.md b/src/README.md
index 3571804..0165c36 100644
--- a/src/README.md
+++ b/src/README.md
@@ -17,7 +17,7 @@ All runtime code for the blowsh-mcp MCP server (TypeScript 7 strict, NodeNext ES
 
 Rules: every outbound URL passes `assertSafeUrl`; every failure throws `FetchError`; strict tsc is the gatekeeper.
 
-Proxy configuration is additive and runs after the SSRF guard. `proxyConfig.ts` resolves the six `PROXY_*` variables at startup, seeds `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` for axios (no per-callsite edits), and writes `network.proxy.*` preferences to `<BROWSH_PROFILE_DIR>/.config/browsh/firefox_profile/user.js` before every Browsh spawn. Firefox ignores proxy environment variables, so this file is the only browser-side lever. Direct mode writes exactly `network.proxy.type=0` to defeat stale volume state, and loopbacks are always bypassed so `127.0.0.1:4333` and Marionette stay local.
+Proxy configuration is additive and runs after the SSRF guard. `proxyConfig.ts` resolves the six `PROXY_*` variables at startup, seeds `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` for axios (no per-callsite edits), and writes `network.proxy.*` plus deterministic WebRTC hardening preferences to `<BROWSH_PROFILE_DIR>/.config/browsh/firefox_profile/user.js` before every Browsh spawn. Every mode appends `media.peerconnection.enabled=false`, `media.peerconnection.ice.proxy_only=true`, and `media.peerconnection.ice.no_host=true` so WebRTC cannot expose host public or local/private IPs. Direct mode writes `network.proxy.type=0` plus the same WebRTC block to defeat stale volume state, and loopbacks are always bypassed so `127.0.0.1:4333` and Marionette stay local.
 
 `browshManager` owns one Browsh/Firefox child behind one FIFO mutex. An unexpected child exit is detected through the `exit`/`error` events (not `ChildProcess.killed`, which stays false on a self-exit), counted by the exported timer-free `CrashCircuit`, and answered by rejecting new renders during a cooldown plus quarantining the suspect profile. Intentional recycle, idle-kill, and shutdown null the process reference before killing, so they are never counted as crashes. Quarantine arms on `stormPending`, set only when a configured-size crash burst opens the circuit, so spaced crashes over a long uptime never move the profile; the lifetime `totalCrashes` field is observability only. `queuePressure` lets optional caller work shed itself instead of growing the queue.
 
diff --git a/src/proxyConfig.ts b/src/proxyConfig.ts
index 2722d93..c379738 100644
--- a/src/proxyConfig.ts
+++ b/src/proxyConfig.ts
@@ -107,11 +107,25 @@ export function resolveProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyC
   return { type, host, port, username, password, bypass };
 }
 
+/**
+ * Deterministic WebRTC hardening appended to every generated `user.js`.
+ *
+ * Disables peer connections and forbids host candidates so Firefox WebRTC
+ * cannot expose the host public IP or local/private interface addresses,
+ * including when Browsh runs behind an upstream proxy. Applied in direct,
+ * HTTP, and SOCKS5 modes. Secure by default with no opt-out knob.
+ */
+const WEBRTC_HARDENING_PREFS: string[] = [
+  'user_pref("media.peerconnection.enabled", false);',
+  'user_pref("media.peerconnection.ice.proxy_only", true);',
+  'user_pref("media.peerconnection.ice.no_host", true);',
+];
+
 /**
  * Build the Firefox `user.js` content for the resolved configuration.
  *
- * Direct mode writes exactly one preference so a stale file left on the
- * `/data/browsh-profile` volume cannot keep a proxy active. String values are
+ * Direct mode writes proxy type 0 plus WebRTC hardening so a stale file left on the
+ * `/data/browsh-profile` volume cannot keep a proxy active or leak IPs. String values are
  * JSON-escaped; integers and booleans are emitted raw, matching Browsh's
  * Marionette preference setter.
  *
@@ -119,7 +133,7 @@ export function resolveProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyC
  * @returns complete `user.js` text, ending with a newline.
  */
 export function buildFirefoxUserJs(config: ProxyConfig): string {
-  if (config.type === "none") return 'user_pref("network.proxy.type", 0);\n';
+  if (config.type === "none") return ['user_pref("network.proxy.type", 0);', ...WEBRTC_HARDENING_PREFS].join("\n") + "\n";
   const lines: string[] = ['user_pref("network.proxy.type", 1);'];
   const noProxies = config.bypass.join(", ");
   if (config.type === "http") {
@@ -137,6 +151,7 @@ export function buildFirefoxUserJs(config: ProxyConfig): string {
   lines.push(`user_pref("network.proxy.no_proxies_on", ${JSON.stringify(noProxies)});`);
   if (config.username.length > 0) lines.push(`user_pref("network.proxy.username", ${JSON.stringify(config.username)});`);
   if (config.password.length > 0) lines.push(`user_pref("network.proxy.password", ${JSON.stringify(config.password)});`);
+  lines.push(...WEBRTC_HARDENING_PREFS);
   return lines.join("\n") + "\n";
 }
 
diff --git a/tests/proxy-config-tests.ts b/tests/proxy-config-tests.ts
index e1216d5..7ae239f 100644
--- a/tests/proxy-config-tests.ts
+++ b/tests/proxy-config-tests.ts
@@ -163,7 +163,7 @@ check("T8 stale manual user.js is overwritten by deterministic direct mode", ()
     fs.writeFileSync(target, 'user_pref("network.proxy.type", 1);\nuser_pref("network.proxy.http", "stale");\n');
     ensureFirefoxProxyPrefs(profileDir, resolveProxyConfig({}));
     const content = fs.readFileSync(target, "utf8");
-    assert.equal(content, 'user_pref("network.proxy.type", 0);\n');
+    assert.equal(content, 'user_pref("network.proxy.type", 0);\nuser_pref("media.peerconnection.enabled", false);\nuser_pref("media.peerconnection.ice.proxy_only", true);\nuser_pref("media.peerconnection.ice.no_host", true);\n');
   } finally {
     fs.rmSync(profileDir, { recursive: true, force: true });
   }
@@ -222,5 +222,73 @@ check("HOTFIX dual NO_PROXY casings both preserved plus loopbacks", () => {
   assert.equal(env.no_proxy, env.NO_PROXY);
 });
 
+// T10 — direct mode includes deterministic WebRTC hardening.
+check("T10 direct mode includes WebRTC hardening", () => {
+  const config = resolveProxyConfig({ PROXY_TYPE: "none" });
+  const userJs = buildFirefoxUserJs(config);
+  assert.ok(userJs.includes('user_pref("media.peerconnection.enabled", false);'));
+  assert.ok(userJs.includes('user_pref("media.peerconnection.ice.proxy_only", true);'));
+  assert.ok(userJs.includes('user_pref("media.peerconnection.ice.no_host", true);'));
+});
+// T11 — HTTP mode includes WebRTC hardening alongside proxy prefs.
+check("T11 http mode includes WebRTC hardening", () => {
+  const config = resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: "8080" });
+  const userJs = buildFirefoxUserJs(config);
+  assert.ok(userJs.includes('user_pref("network.proxy.http", "proxy.example.com");'));
+  assert.ok(userJs.includes('user_pref("media.peerconnection.enabled", false);'));
+  assert.ok(userJs.includes('user_pref("media.peerconnection.ice.proxy_only", true);'));
+  assert.ok(userJs.includes('user_pref("media.peerconnection.ice.no_host", true);'));
+  assert.ok(userJs.includes("localhost"));
+  assert.ok(userJs.includes("127.0.0.1"));
+});
+// T12 — SOCKS5 mode includes WebRTC hardening alongside socks prefs.
+check("T12 socks5 mode includes WebRTC hardening", () => {
+  const config = resolveProxyConfig({ PROXY_TYPE: "socks5", PROXY_HOST: "socks.example.com", PROXY_PORT: "1080" });
+  const userJs = buildFirefoxUserJs(config);
+  assert.ok(userJs.includes('user_pref("network.proxy.socks", "socks.example.com");'));
+  assert.ok(userJs.includes('user_pref("network.proxy.socks_remote_dns", true);'));
+  assert.ok(userJs.includes('user_pref("media.peerconnection.enabled", false);'));
+  assert.ok(userJs.includes('user_pref("media.peerconnection.ice.proxy_only", true);'));
+  assert.ok(userJs.includes('user_pref("media.peerconnection.ice.no_host", true);'));
+});
+// T13 — stale user.js overwrite gains WebRTC policy in all modes.
+check("T13 stale user.js overwrite gains WebRTC policy in all modes", () => {
+  const modes = [{ PROXY_TYPE: "none" }, { PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: "8080" }, { PROXY_TYPE: "socks5", PROXY_HOST: "socks.example.com", PROXY_PORT: "1080" }];
+  for (const env of modes) {
+    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "blowsh-webrtc-test-"));
+    try {
+      const target = path.join(profileDir, ".config", "browsh", "firefox_profile", "user.js");
+      fs.mkdirSync(path.dirname(target), { recursive: true });
+      fs.writeFileSync(target, 'user_pref("network.proxy.type", 1);\nuser_pref("network.proxy.http", "stale");\n');
+      ensureFirefoxProxyPrefs(profileDir, resolveProxyConfig(env));
+      const content = fs.readFileSync(target, "utf8");
+      assert.ok(!content.includes('"stale"'));
+      assert.ok(content.includes('user_pref("media.peerconnection.enabled", false);'));
+      assert.ok(content.includes('user_pref("media.peerconnection.ice.proxy_only", true);'));
+      assert.ok(content.includes('user_pref("media.peerconnection.ice.no_host", true);'));
+    } finally {
+      fs.rmSync(profileDir, { recursive: true, force: true });
+    }
+  }
+});
+// T14 — WebRTC prefs do not log credentials.
+check("T14 webrtc prefs do not log credentials", () => {
+  const config = resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: "8080", PROXY_USERNAME: "user@name", PROXY_PASSWORD: 'p@ss/word:"x' });
+  const logged: string[] = [];
+  const originalLog = console.log;
+  const originalError = console.error;
+  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
+  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
+  try {
+    buildFirefoxUserJs(config);
+  } finally {
+    console.log = originalLog;
+    console.error = originalError;
+  }
+  assert.ok(!logged.some((line) => line.includes("p@ss")));
+  const userJs = buildFirefoxUserJs(config);
+  assert.ok(userJs.includes('user_pref("media.peerconnection.enabled", false);'));
+});
+
 console.log(`\n${checks - failures}/${checks} checks passed`);
 if (failures > 0) process.exitCode = 1;
```
<!-- END_GIT_DIFF -->
