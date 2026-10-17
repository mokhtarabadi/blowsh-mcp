# src — server-side modules

All runtime code for the blowsh-mcp MCP server (TypeScript 7 strict, NodeNext ESM, `.js` suffix on relative imports).

| Module | Duty (one line) |
| --- | --- |
| `server.ts` | MCP wiring: 5 tool schemas, zod validation, stdio/http/sse transports, lifecycle |
| `browshManager.ts` | Browsh process lifecycle + HTTP fetch (PLAIN/DOM), mutex, recycle/idle |
| `html2markdownManager.ts` | Spawn wrapper for the html2markdown CLI |
| `ssrf.ts` | `assertSafeUrl` guard — must run before any URL reaches the network |
| `cache.ts` | TTL in-memory render cache |
| `extract.ts` | Main-content extraction, selector/toc/section/focus/must_contain/stitch |
| `errors.ts` | `FetchError` + message formatting (never return error strings as success) |
| `guard.ts` | Bot-guard detection + per-host verdict cache + fetch logging |
| `tools/` | Per-tool handlers, one file per MCP tool (see `tools/README.md`) |

Rules: every outbound URL passes `assertSafeUrl`; every failure throws `FetchError`; strict tsc is the gatekeeper.
