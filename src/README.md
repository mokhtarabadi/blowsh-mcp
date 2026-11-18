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
| `tools/` | Per-tool handlers, one file per MCP tool (see `tools/README.md`) |

Rules: every outbound URL passes `assertSafeUrl`; every failure throws `FetchError`; strict tsc is the gatekeeper.

`browshManager` owns one Browsh/Firefox child behind one FIFO mutex. An unexpected child exit is detected through the `exit`/`error` events (not `ChildProcess.killed`, which stays false on a self-exit), counted by the exported timer-free `CrashCircuit`, and answered by rejecting new renders during a cooldown plus quarantining the suspect profile. Intentional recycle, idle-kill, and shutdown null the process reference before killing, so they are never counted as crashes. Quarantine arms on `stormPending`, set only when a configured-size crash burst opens the circuit, so spaced crashes over a long uptime never move the profile; the lifetime `totalCrashes` field is observability only. `queuePressure` lets optional caller work shed itself instead of growing the queue.

Sibling docs: this file plus `DECISIONS.md` (dated ADRs for the server-side modules). Tool-level records live in `tools/README.md` and `tools/DECISIONS.md`. Every `.ts` file in this tree carries a one-line `// Sibling Docs:` pointer at the top.
