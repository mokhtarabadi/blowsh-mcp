v2.1.1 bug-fix quirks (2026-08-03):
- search_web engines (DDG/Bing) render CONCURRENTLY with abort-on-first-results; IA probe parallel; enrich sequential with 45s wall-clock budget (ENRICH_BUDGET_MS). Worst single search ~22-26s.
- browshManager: axios accepts AbortSignal (engine race); one-shot retry also on ECONNREFUSED/ECONNRESET/EHOSTUNREACH/ENETUNREACH (external crash, not just recycle). Cancellation passes through untouched.
- waitForReady boot budget is 30s (was 10s) — cold parallel starts exceed 10s.
- opencode client: blowsh MCP timeout + experimental.mcp_timeout = 120s (global + project configs). -32001 was client 30s timeout vs server latency.
- search results carry fetched_at (UTC epoch ms) per conventions.
- Known flake: fetch_web selector test can intermittently return 'matched nothing' when Firefox is settling after heavy search load — retry the call.