# src — server-side modules

All runtime code for the blowsh-mcp MCP server (TypeScript 7 strict, NodeNext ESM, `.js` suffix on relative imports).

| Module | Duty (one line) |
| --- | --- |
| `server.ts` | MCP wiring: 5 tool schemas, zod validation, stdio/http/sse transports, lifecycle |
| `browshManager.ts` | Browsh process lifecycle + HTTP fetch (PLAIN/DOM), mutex, recycle/idle, crash circuit |
| `html2markdownManager.ts` | Spawn wrapper for the html2markdown CLI |
| `ssrf.ts` | `assertSafeUrl` guard — must run before any URL reaches the network |
| `cache.ts` | TTL in-memory render cache |
| `extract.ts` | Main-content extraction, selector/toc/section/focus/must_contain/stitch |
| `errors.ts` | `FetchError` + message formatting (never return error strings as success) |
| `guard.ts` | Bot-guard detection + per-host verdict cache + fetch logging |
| `proxyConfig.ts` | Resolve `PROXY_*` env, seed axios proxy env, write Firefox `user.js` into the redirected profile |
| `tools/` | Per-tool handlers, one file per MCP tool (see `tools/README.md`) |

Rules: every outbound URL passes `assertSafeUrl`; every failure throws `FetchError`; strict tsc is the gatekeeper.

Proxy configuration is additive and runs after the SSRF guard. `proxyConfig.ts` resolves the six `PROXY_*` variables at startup, seeds `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` for axios (no per-callsite edits), and writes `network.proxy.*` plus deterministic WebRTC hardening preferences to `<BROWSH_PROFILE_DIR>/.config/browsh/firefox_profile/user.js` before every Browsh spawn. Every mode appends `media.peerconnection.enabled=false`, `media.peerconnection.ice.proxy_only=true`, and `media.peerconnection.ice.no_host=true` so WebRTC cannot expose host public or local/private IPs. Direct mode writes `network.proxy.type=0` plus the same WebRTC block to defeat stale volume state, and loopbacks are always bypassed so `127.0.0.1:4333` and Marionette stay local.

`browshManager` owns one Browsh/Firefox child behind one FIFO mutex. An unexpected child exit is detected through the `exit`/`error` events (not `ChildProcess.killed`, which stays false on a self-exit), counted by the exported timer-free `CrashCircuit`, and answered by rejecting new renders during a cooldown plus quarantining the suspect profile. Intentional recycle, idle-kill, and shutdown null the process reference before killing, so they are never counted as crashes. Quarantine arms on `stormPending`, set only when a configured-size crash burst opens the circuit, so spaced crashes over a long uptime never move the profile; the lifetime `totalCrashes` field is observability only. `queuePressure` lets optional caller work shed itself instead of growing the queue.

### Orphan Firefox cleanup

Group SIGTERM sweep of orphaned Firefox for the Browsh profile on teardown, spawn, and unexpected exit. Allowlist under /data or os.tmpdir at depth 3+. pkill TERM, wait 2 s, then KILL. pgrep gate before lock delete. Safe degrade on missing pkill/pgrep. Same sweep before spawn and on child exit.

Sibling docs: this file plus `DECISIONS.md` (dated ADRs for the server-side modules). Tool-level records live in `tools/README.md` and `tools/DECISIONS.md`. Every `.ts` file in this tree carries a one-line `// Sibling Docs:` pointer at the top.
