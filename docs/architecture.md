# Architecture Overview

This document serves as a critical, living description of blowsh-mcp's architecture, enabling quick onboarding and efficient contribution. Update it as the codebase evolves.

## 1. Project Structure

```
blowsh-mcp/
├── src/                            # All server-side code
│   ├── server.ts                   # MCP Server wiring: stdio transport, tool list, routing, lifecycle
│   ├── browshManager.ts            # Browsh process lifecycle + HTTP fetch (PLAIN/DOM modes)
│   ├── html2markdownManager.ts     # Spawn wrapper for the html2markdown CLI
│   ├── ssrf.ts                     # assertSafeUrl guard (DNS-resolved private-IP blocklist)
│   ├── cache.ts                    # TTL in-memory cache shared by all fetch tools
│   ├── extract.ts                  # Main-content extraction, CSS selector helpers, truncation
│   ├── errors.ts                   # FetchError + message formatting
│   └── tools/
│       ├── fetchWeb.ts             # fetch_web: plain/html/markdown/pdf + selector/max_chars/wait_ms
│       ├── extractPdf.ts           # type: pdf — SSRF-guarded download → pdftotext (size-capped)
│       ├── searchWeb.ts            # search_web: pagination, DDG instant answer, enrich
│       ├── extractLinks.ts         # extract_links: hyperlinks from rendered DOM
│       └── fetchWebBatch.ts        # fetch_web_batch: multi-URL, per-URL error isolation
├── docs/                           # conventions.md, architecture.md, data_model.md
├── tasks/                          # Kanban workflow (backlog/in-progress/qa/completed/archive)
├── Dockerfile                      # Multi-stage: build TS, bundle Firefox+Browsh+html2markdown
├── .opencode/skills/               # Workspace-local agent skills (optional)
├── .env.example                    # Documented configuration surface
├── package.json / tsconfig.json    # TS 7 strict, NodeNext ESM
└── dist/                           # tsc output (gitignored)
```

## 2. High-Level System Diagram

```
[MCP Client / AI Agent]
      │  JSON-RPC (stdio)
      ▼
[MCP Server: blowsh-mcp 2.0.0]
   ├─ tools: fetch_web, search_web, extract_links, fetch_web_batch
   ├─ assertSafeUrl()  ──►  SSRF blocklist (private/loopback/link-local)
   ├─ pageCache (TTL)  ──►  repeated calls served without re-render
   ▼
[Browsh Manager (127.0.0.1:4333, single reuse instance)]
   └─ Browsh CLI ──► headless Firefox (full JS execution)
   └─ X-Browsh-Raw-Mode: PLAIN → text  |  DOM → HTML
   ▼
[html2markdown CLI]  (only for type: "markdown")
```

## 3. Core Components

### 3.1. MCP Server (`src/server.ts`)

- Registers four tools (SDK 1.30 `ToolSchema`), validates args with zod 4, routes to `src/tools/*`, wraps errors into `isError: true` responses.
- Transport: `StdioServerTransport` (line-delimited JSON-RPC).
- Lifecycle: graceful SIGINT/SIGTERM/exit shutdown → `browshManager.shutdown()`.

### 3.2. Browsh Manager (`src/browshManager.ts`)

- Lazy-starts `browsh --http-server-mode` once; health-probes `http://127.0.0.1:4333/` for readiness.
- `fetchRaw(url, mode)` GETs `127.0.0.1:4333/<url>` with `X-Browsh-Raw-Mode`; translates HTTP failures into `FetchError` with status code.
- Port/host are fixed by Browsh (not configurable). Request timeout configurable via `BROWSH_REQUEST_TIMEOUT_MS`.
- **Session health (v2.1):** a mutex serializes all renders. The process is recycled after `BROWSH_RECYCLE_REQUESTS` requests and killed after `BROWSH_IDLE_TIMEOUT_MS` idle (cache-mopped). Recycle/idle only fire in quiescent windows (`busy=false`, no waiters — `scheduleRecycle` defers via `setImmediate`) and tear down the whole process group (`detached: true` + negative-PID SIGTERM/SIGKILL) so orphaned Firefox child processes never hold the profile lock or block restarts. One-shot transport retry after a recycle.

### 3.3. Fetch Tools (`src/tools/`)

- `fetchWeb`: plain (Browsh PLAIN), html (Browsh DOM), markdown (DOM + main-content extraction + html2markdown CLI), pdf (bypasses browser: SSRF-guarded direct download → `pdftotext`, size-capped via `PDF_MAX_BYTES`). Optional `selector` (CSS), `max_chars`, `wait_ms` (JS-settle polling until DOM stable) — ignored for `pdf`.
- `extractPdf`: direct axios stream (SSRF-guarded, Content-Type + Content-Length + streaming size caps) piped through `pdftotext - -`; text-only caching.
- `searchWeb`: renders DuckDuckGo HTML, falls back to Bing; returns `{title, url, snippet}[]`. `page` (1-10) synthesizes engine offsets; DuckDuckGo Instant Answer API is probed first (graceful null on any failure), and optional `enrich` replaces top-3 snippets via cache-aware fetches.
- `extractLinks`: parses `a[href]` from rendered DOM; absolute URL resolution; non-web protocols skipped.
- `fetchWebBatch`: up to 10 URLs sequentially; per-URL `{url, ok, content|error}` — never fails wholesale.

### 3.4. Security / caching (`src/ssrf.ts`, `src/cache.ts`)

- `assertSafeUrl(url)`: DNS-resolves hostname; rejects loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16), reserved, IPv4-mapped IPv6, `localhost`. Disable via `ALLOW_PRIVATE_URLS=true`.
- `pageCache`: in-memory TTL map (default 5 min, `CACHE_TTL_MS`).

## 4. Data Stores

- None persistent. Single in-memory TTL render cache (`src/cache.ts`).

## 5. External Integrations / APIs

- **Browsh CLI** (v1.8.0): text browser backed by headless Firefox; local HTTP service on 127.0.0.1:4333.
- **Firefox** (`firefox-esr` on Debian): JS engine + DOM renderer; `BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr`.
- **html2markdown CLI** (v2.5.2): converts extracted HTML to Markdown.
- **Search engines** (external, outbound): DuckDuckGo HTML (`html.duckduckgo.com`), Bing (`www.bing.com`).

## 6. Deployment & Infrastructure

- **Provider:** Any server with Docker; runs completely offline-of-host once the image is built.
- **Form factor:** MCP server over stdio (no listening port). The Browsh HTTP port stays container-private.
- **CI/CD:** none currently; verify with build + `docker build` + JSON-RPC smoke test.

## 7. Security Considerations

- SSRF guard domain-level: every outbound URL passes `assertSafeUrl`; loopback access to the Browsh service directly via `fetch_web` is blocked.
- External binaries run in the container; no host linkage.
- Structured error surface: failures are errors (`isError: true`), never successful string payloads.

## 8. Development & Testing Environment

- **Local dev:** Node >= 20.18; `npm run build` (tsc strict), `npm run dev` (tsx).
- **Runtime verification:** containers only; Firefox/Browsh/html2markdown are not installed on the host.
- Residue tests: MCP JSON-RPC smoke scripts (initialize → list → call) over `docker run -i`.

## 9. Future Considerations / Roadmap

- Search pagination beyond page 10 / query-variant automation.
- Multi-tab backpressure / tab-recycling after long sessions.
- SSRF allowlist enrichment (public suffix validation, blocked TLD lists).