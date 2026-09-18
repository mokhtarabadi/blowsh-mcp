# Architecture Overview

This document serves as a critical, living description of blowsh-mcp's architecture, enabling quick onboarding and efficient contribution. Update it as the codebase evolves.

## 1. Project Structure

```
blowsh-mcp/
├── src/                            # All server-side code
│   ├── server.ts                   # MCP Server wiring: stdio transport, tool list, routing, lifecycle (5 tools in v2.3.2)
│   ├── browshManager.ts            # Browsh process lifecycle + HTTP fetch (PLAIN/DOM modes)
│   ├── html2markdownManager.ts     # Spawn wrapper for the html2markdown CLI
│   ├── ssrf.ts                     # assertSafeUrl guard (DNS-resolved private-IP blocklist)
│   ├── cache.ts                    # TTL in-memory cache shared by all fetch tools
│   ├── extract.ts                  # Main-content extraction, selector helpers, truncation + BM25 focus, toc/section, must_contain, stitch
│   ├── errors.ts                   # FetchError + message formatting
│   ├── guard.ts                    # Bot-guard detection (Cloudflare/Turnstile/reCAPTCHA) + per-host verdict cache + fetch logging
│   └── tools/
│       ├── fetchWeb.ts             # fetch_web: plain/html/markdown/pdf + selector/max_chars/wait_ms + focus/toc/section/must_contain/archive/stitch
│       ├── extractPdf.ts           # type: pdf — SSRF-guarded download → pdftotext (size-capped)
│       ├── searchWeb.ts            # search_web: 4-engine consensus + intent verticals + query_variants + deadline + enrich
│       ├── crawlWeb.ts             # crawl_web: sitemap discovery, frontier BM25-lite, Governor pacing, resume tokens
│       ├── extractLinks.ts         # extract_links: hyperlinks from rendered DOM
│       └── fetchWebBatch.ts        # fetch_web_batch: multi-URL, per-URL error isolation
├── docs/                           # conventions.md, architecture.md, data_model.md
├── tasks/                          # Kanban workflow (backlog/in-progress/qa/completed/archive)
├── .github/workflows/              # docker-publish.yml: CI/CD build → ghcr.io
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
[MCP Server: blowsh-mcp 2.3.2]
   ├─ tools: fetch_web, search_web, crawl_web, extract_links, fetch_web_batch
   ├─ assertSafeUrl()  ──►  SSRF blocklist (private/loopback/link-local)
   ├─ pageCache (TTL)  ──►  repeated calls served without re-render
   ├─ queryCache (search, intent-aware TTL) + crawl resume/fingerprint files (os.tmpdir)
      ▼
[Browsh Manager (127.0.0.1:4333, single reuse instance)]
   └─ Browsh CLI ──► headless Firefox (full JS execution)
   └─ X-Browsh-Raw-Mode: PLAIN → text  |  DOM → HTML
      ▼
[html2markdown CLI]  (only for type: "markdown")
   + [Wayback API] for archive=auto/only + sitemap XML over axios for crawl map
```

## 3. Core Components

### 3.1. MCP Server (`src/server.ts`)

- Registers five tools (SDK 1.30 `ToolSchema`) — `fetch_web`, `search_web`, `crawl_web`, `extract_links`, `fetch_web_batch` — validates args with zod 4, routes to `src/tools/*`, wraps errors into `isError: true` responses. v2.3.0 bumps reported version to 2.3.0.
- Transport: `StdioServerTransport` (line-delimited JSON-RPC).
- Lifecycle: graceful SIGINT/SIGTERM/exit shutdown → `browshManager.shutdown()`.

### 3.2. Browsh Manager (`src/browshManager.ts`)

- Lazy-starts `browsh --http-server-mode` once; health-probes `http://127.0.0.1:4333/` for readiness.
- `fetchRaw(url, mode)` GETs `127.0.0.1:4333/<url>` with `X-Browsh-Raw-Mode`; translates HTTP failures into `FetchError` with status code.
- Port/host are fixed by Browsh (not configurable). Request timeout configurable via `BROWSH_REQUEST_TIMEOUT_MS`.
- **Session health (v2.1):** a mutex serializes all renders. The process is recycled after `BROWSH_RECYCLE_REQUESTS` requests and killed after `BROWSH_IDLE_TIMEOUT_MS` idle (cache-mopped). Recycle/idle only fire in quiescent windows (`busy=false`, no waiters — `scheduleRecycle` defers via `setImmediate`) and tear down the whole process group (`detached: true` + negative-PID SIGTERM/SIGKILL) so orphaned Firefox child processes never hold the profile lock or block restarts. One-shot transport retry after a recycle.

### 3.3. Fetch Tools (`src/tools/`)

- `fetchWeb`: plain (Browsh PLAIN), html (Browsh DOM), markdown (DOM + main-content extraction + html2markdown CLI), pdf (bypasses browser: SSRF-guarded direct download → `pdftotext`, size-capped via `PDF_MAX_BYTES`). Optional `selector` (CSS), `max_chars`, `wait_ms` (JS-settle polling until DOM stable) — ignored for `pdf`. v2.3.0 extras: `focus` (BM25-lite relevance filter, `focusFilter()` in extract.ts), `toc`/`section` (`extractToc`/`extractSectionHtml`), `must_contain` probe (`probeMustContain` → MATCH/NO-MATCH + excerpts), `archive` (Wayback `fetchWaybackSnapshot` on `archive=auto`/`only`), `stitch` (`fetchStitchedMarkdown` following `rel=next` up to 6 parts, same-host).
- `extractPdf`: direct axios stream (SSRF-guarded, Content-Type + Content-Length + streaming size caps) piped through `pdftotext - -`; text-only caching.
- `searchWeb`: renders 4 engines (DDG, Bing, Brave, Mojeek) concurrently and merges by consensus (cross-engine agreement) rather than winner-takes-all; Brave/Mojeek parsers + `mergeResults()` + `queryCache` (intent-aware TTL). `page` (1-10) synthesizes engine offsets; DuckDuckGo Instant Answer API is probed first (graceful null on any failure), and optional `enrich` replaces top-3 snippets via cache-aware fetches. v2.3.0 adds `query_variants` (parallel, merged), `intent` (auto/web/code/paper/news/entity selects verticals: GitHub/Wikipedia/arXiv/HN via direct axios), `deadline_ms` (hard budget → `deadline.hit` error), and 4-engine + vertical fan-out.
- `crawlWeb`: sitemap-aware crawl — `discoverSitemaps()` (robots.txt + sitemap.xml over axios, `parseSitemapXml`), frontier best-first (`scoreCandidate` BM25-lite over anchor+path), Governor pacing (dwell variance + crawl-delay + exponential backoff on 429), `effectiveExcludes`/`scopeAllowed` globs, robots `fetchRobots`/`isAllowed`, disk-backed resume tokens (`blowsh-crawl-resumes.json`, 30 min TTL, atomic rename) and `since_last` fingerprint file, `qualityScore`/`contentKind` heuristics, budgets (`max_pages`/`max_total_chars`/`deadline_s`), stop reasons.
- `extractLinks`: parses `a[href]` from rendered DOM; absolute URL resolution; non-web protocols skipped.
- `fetchWebBatch`: up to 10 URLs sequentially; per-URL `{url, ok, content|error}` — never fails wholesale.

### 3.4. Security / caching (`src/ssrf.ts`, `src/cache.ts`)

- `assertSafeUrl(url)`: DNS-resolves hostname; rejects loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16), reserved, IPv4-mapped IPv6, `localhost`. Disable via `ALLOW_PRIVATE_URLS=true`.
- `pageCache`: in-memory TTL map (default 5 min, `CACHE_TTL_MS`).
- `guard.ts` (bot-guard detection — extends, not duplicates, `ssrf.ts`): `detectGuard(content)` classifies page text into `GuardKind` (`captcha`, `rate-limit`, `ip-block`, `browser-check`, `consent-wall`, …); per-host verdict cache (1h TTL, 1000-entry cap); one JSON stderr line per fetch (host + guard status + duration, `GUARD_DETECT=0` kill-switch); additive HTML-comment trailer on guarded HTML only.

## 4. Data Stores

- None persistent by default. Single in-memory TTL render cache (`src/cache.ts`) + search query cache (`queryCache` in searchWeb.ts, intent-aware TTL, 100-entry cap).
- **Crawl ephemeral persistence:** resume tokens (`os.tmpdir()/blowsh-crawl-resumes.json`, 30 min TTL, file-locked via atomic rename) and `since_last` fingerprints (`blowsh-crawl-fingerprints.json`, <24h). Not a DB; best-effort tmp files.

## 5. External Integrations / APIs

- **Browsh CLI** (v1.8.0): text browser backed by headless Firefox; local HTTP service on 127.0.0.1:4333.
- **Firefox** (`firefox-esr` on Debian): JS engine + DOM renderer; `BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr`.
- **html2markdown CLI** (v2.5.2): converts extracted HTML to Markdown.
- **Search engines** (external, outbound): DuckDuckGo HTML (`html.duckduckgo.com`), Bing (`www.bing.com`), Brave (`search.brave.com`), Mojeek (`www.mojeek.com`).
- **Verticals / archive / sitemaps (axios, no Browsh):** GitHub HTML, Wikipedia opensearch, arXiv export API, HN Algolia, Wayback `archive.org/wayback/available`, sitemap XML, robots.txt.

## 6. Deployment & Infrastructure

- **Provider:** Any server with Docker; runs completely offline-of-host once the image is pulled.
- **Distribution:** Prebuilt image on GitHub Container Registry — `ghcr.io/mokhtarabadi/blowsh-mcp:latest` (also tagged `2.3.2`, branch, semver, and `sha-<sha>`). Pull with `docker pull ghcr.io/mokhtarabadi/blowsh-mcp:latest`.
- **CI/CD:** GitHub Actions (`.github/workflows/docker-publish.yml`) builds the Dockerfile and pushes to ghcr on `main` pushes and `v*` tags, with a container smoke test (MCP initialize → tools/list) before the run completes.
- **Form factor:** MCP server over stdio (no listening port). The Browsh HTTP port stays container-private.

## 7. Security Considerations

- SSRF guard domain-level: every outbound URL passes `assertSafeUrl`; loopback access to the Browsh service directly via `fetch_web` is blocked.
- External binaries run in the container; no host linkage.
- Structured error surface: failures are errors (`isError: true`), never successful string payloads.

## 8. Development & Testing Environment

- **Local dev:** Node >= 20.18; `npm run build` (tsc strict), `npm run dev` (tsx).
- **Runtime verification:** containers only; Firefox/Browsh/html2markdown are not installed on the host.
- Residue tests: MCP JSON-RPC smoke scripts (initialize → list → call) over `docker run -i`.

## 9. Future Considerations / Roadmap

Prioritized (highest value / lowest risk first; deferred items marked as such):

1. **SSRF allowlist enrichment** (security first: public-suffix validation, blocked TLD lists). **Owner:** Security and networking.
2. **Reference handles (L/S) + progressToken streaming; section-level fingerprint diff** (`since_last` is naive whole-page hash only). **Owner:** MCP protocol and platform.
3. **Domain intelligence adapters** (Reddit, npm/PyPI/crates, StackOverflow) — only minimal verticals now. **Owner:** Integrations.
4. **Multi-tab backpressure / tab-recycling** after long sessions. **Owner:** Browser runtime.
5. **Browser actions** (click/type/press/wait_selector/wait_text) — **deferred**: Browsh 1.8.0 HTTP mode cannot drive page interaction (vs DonSeTch ghost); needs a different browser backend. **Owner:** Browser backend research.

- ~~Search pagination beyond page 10 / query-variant automation.~~ **Done in v2.3.0** (query_variants + 4-engine consensus).