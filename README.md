# blowsh-mcp

**Model Context Protocol Server for JS-Capable Terminal Browsing with Browsh**

---

## What is blowsh-mcp?

blowsh-mcp is a Model Context Protocol (MCP) server that exposes the power of Browsh—a fully JavaScript-capable terminal browser—to any AI Agent, IDE agent, or MCP client. This project allows your AI to fetch and render any modern web page, including those requiring JavaScript, and receive the result as easily-parsed plain text, HTML, or Markdown.

Mnemonic: “blowsh” = Browsh-powered MCP server.

---

## Key Features

- **fetch_web Tool:** Unified tool for readable plain text, HTML, or Markdown extraction (after full JS rendering). Supports CSS `selector` extraction, `max_chars` output caps, and `wait_ms` JS-settle polling.
- **search_web Tool:** Discover pages via a rendered search engine (DuckDuckGo HTML with Bing fallback) — ranked results with URLs and snippets.
- **extract_links Tool:** List hyperlinks (text + absolute URL) from any JS-rendered page for navigation following.
- **fetch_web_batch Tool:** Fetch up to 10 URLs in one call with per-URL error isolation.
- **SSRF guard:** Refuses requests to loopback, private, link-local, or reserved addresses (DNS-resolved), protecting the server-side browser.
- **AI-optimized tool documentation:** Inputs, outputs, and illustrated use-cases designed for seamless agent automation. Tools throw structured errors with HTTP status codes (`isError` in MCP responses).
- **Robust Browsh management:** Launches Browsh once, keeps it running, reuses a RAM/CPU-light singleton, graceful shutdown on exit.
- **In-memory render cache with TTL:** Repeated fetches are served instantly without re-rendering.
- **Designed for PaaS, Cloud, Local AI tools, and IDE agents.**

---

## Links

- [Browsh CLI Browser](https://www.brow.sh/) — The rendering engine.
- [Firefox](https://www.mozilla.org/en-US/firefox/new/) — Required as the backend for Browsh.
- [Model Context Protocol (MCP) Specification](https://github.com/modelcontextprotocol/spec) — The agent/server protocol.

---

## How it Works

1. AI/Agent makes an MCP request: `fetch_web` (single URL), `search_web` (query), `extract_links` (URL), or `fetch_web_batch` (up to 10 URLs).
2. blowsh-mcp launches Browsh in HTTP server mode (on first use) and reuses it for all later calls.
3. blowsh-mcp requests the raw output from Browsh, using `X-Browsh-Raw-Mode: PLAIN` (for text), `DOM` (for HTML), or fetches HTML and then converts to Markdown.
4. The page (after full JS execution) is returned as terminal plain text, rich HTML DOM, or clean Markdown—AI/agents pick the output type to match downstream processing.
5. Results are cached in memory (TTL) so repeated fetches are instant; every request is SSRF-checked before reaching the browser.

---

## Example Usage

**From Claude, Cursor, or any MCP-enabled agent:**

```json
{
  "tool": "search_web",
  "params": { "query": "bitcoin price today", "max_results": 5 }
}
// → Ranked results with URLs + snippets → feed top URL to fetch_web

{
  "tool": "fetch_web",
  "params": { "url": "https://coindesk.com/price/bitcoin/", "type": "plain" }
}
// → Returns readable plain text (live price as text table, etc)

{
  "tool": "fetch_web",
  "params": { "url": "https://coindesk.com/price/bitcoin/", "type": "markdown", "selector": "main", "wait_ms": 3000 }
}
// → Markdown of <main> only, after JS settles ("# Bitcoin Price\n\n| Time | Price | ...")

{
  "tool": "extract_links",
  "params": { "url": "https://example.com", "limit": 20 }
}
// → [{"text": "Learn more", "url": "https://iana.org/domains/example"}, ...]

{
  "tool": "fetch_web_batch",
  "params": { "urls": ["https://a.com", "https://b.com"], "type": "markdown" }
}
// → Per-URL results; a failing page never fails the batch
```

AI receives:
- With `type: plain`: pure readable text (tables, lists, main body content; ideal for NLP/summarization or terminal context ingestion).
- With `type: html`: the full HTML markup, after all JavaScript. Use for element parsing, link graph construction, complex scrapes, etc.
- With `type: markdown`: a clean Markdown version—best for LLM context chunks, semantic pipelines, and AI-friendly consumption/workflows.
- Errors are structured: MCP responses set `isError: true` with a `FetchError` message including the HTTP status when available.

---

## Project Structure

- `src/server.ts` — MCP server exposing tools.
- `src/browshManager.ts` — Launch, monitor, shutdown Browsh.
- `src/tools/fetchWeb.ts` — fetchWeb tool implementation (plain, html, markdown; selector/max_chars/wait_ms).
- `src/tools/searchWeb.ts` — search_web (DuckDuckGo HTML + Bing fallback parser).
- `src/tools/extractLinks.ts` — extract_links (hyperlinks from rendered DOM).
- `src/tools/fetchWebBatch.ts` — fetch_web_batch (multi-URL, per-URL error isolation).
- `src/tools/html2markdownManager.ts` — Wrapper for html2markdown CLI.
- `src/ssrf.ts` — SSRF guard (blocks private/loopback/reserved targets).
- `src/cache.ts` — In-memory TTL render cache.
- `src/extract.ts` — Main-content extraction, selector helpers, truncation.
- `src/errors.ts` — `FetchError` + message formatting.
- `README.md` — This file.
- `Dockerfile` — Multi-stage container (builds TS, bundles Firefox, Browsh, html2markdown).
- `.env` — Config overrides. See `.env.example` for all options.

---

## Installation

**Requirements:**  

- Node.js >= 20.18  
- Firefox installed and in PATH  
- [Browsh CLI](https://www.brow.sh/downloads/) installed and in PATH  
- [html2markdown CLI](https://github.com/JohannesKaufmann/html-to-markdown) installed and in PATH  
  - On Debian/Ubuntu, install with:
    ```sh
    wget -O /tmp/html2markdown.deb "https://github.com/JohannesKaufmann/html-to-markdown/releases/download/v2.5.2/html2markdown_2.5.2_linux_amd64.deb"
    sudo apt-get install -y /tmp/html2markdown.deb
    rm /tmp/html2markdown.deb
    ```
  - Or use the prebuilt binary for your OS from the [releases page](https://github.com/JohannesKaufmann/html-to-markdown/releases).

> Prefer Docker? Skip the host-side installs entirely — the multi-stage image bundles
> Firefox, Browsh, and html2markdown:
> ```sh
> docker build -t blowsh-mcp:latest .
> docker run --rm -i blowsh-mcp:latest
> ```

```sh
git clone https://github.com/mokhtarabadi/blowsh-mcp.git
cd blowsh-mcp
npm install
npm run build
```

---

### Run the MCP server

After building, start the server using:

```sh
node dist/server.js
```

Replace `dist/server.js` with the correct path if your build output differs.


Create a `.env` file as needed for configuration. For example:

```env
MCP_TRANSPORT=stdio
BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr
HTML2MARKDOWN_PATH=html2markdown
CACHE_TTL_MS=300000
BROWSH_REQUEST_TIMEOUT_MS=30000
ALLOW_PRIVATE_URLS=false
NODE_ENV=production
```
- `BROWSH_FIREFOX_PATH` lets you customize the Firefox executable used by Browsh during headless/HTTP operation.
- `HTML2MARKDOWN_PATH` lets you specify a custom path to the html2markdown binary (default: `html2markdown` in PATH).
- `CACHE_TTL_MS`, `BROWSH_REQUEST_TIMEOUT_MS`, and `ALLOW_PRIVATE_URLS` tune the render cache, per-request timeout, and SSRF guard respectively.
- Browsh's HTTP port/host are NOT configurable.

---

## Project Documentation

| File                     | Audience | Purpose                                            |
|--------------------------|----------|----------------------------------------------------|
| `AGENTS.md`              | Agents   | Operating rules, guardrails, task lifecycle        |
| `DESIGN.md`              | All      | MCP response/output design language                |
| `docs/architecture.md`   | Devs     | System overview, component wiring                  |
| `docs/data_model.md`     | Devs     | Tool input/output schemas and error model          |
| `docs/conventions.md`    | Devs     | DateTime standard, SOLID guidelines                |
| `CHANGELOG.md`           | All      | Version history (Keep a Changelog)                 |
| `tasks/`                 | Team     | Kanban task files (backlog → archive)              |

This README is the user-facing entry point; agent-facing rules live in `AGENTS.md` and are mandatory reading before any implementation.

---

## Tool API

| Name             | Params                                                                                                                                                                                                                          | AI Use-case/Description                                                                                                                                                                                                                 |
|------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| fetch_web        | `{ url, type: "plain"\|"html"\|"markdown"\|"pdf", selector?, max_chars?, wait_ms? }`                                                                     | Fetch one page post-JS-render as text/HTML/Markdown. `selector` (CSS) extracts only the matched element; `max_chars` caps output; `wait_ms` polls until JS settles. `type: pdf` downloads the PDF directly (20 MB max) and extracts text via pdftotext — `selector`/`wait_ms`/`max_chars` do not apply. |
| search_web       | `{ query: string, max_results?: number, page?: number, enrich?: boolean }`                                                                                                                                            | Search the web (DuckDuckGo HTML + Bing rendered concurrently) and return `[{title, url, snippet, fetched_at}]`. `page` 1–10 for pagination; `enrich: true` replaces top-3 snippets with fetched markdown content (45 s budget). `fetched_at` is UTC epoch ms for staleness. Feed result URLs to fetch_web/extract_links. |
| extract_links    | `{ url: string, limit?: number }`                                                                                                                                                                                             | Return all hyperlinks (`{text, url}`, absolute) present on a JS-rendered page, for navigation following without full DOM dumps.                                                  |
| fetch_web_batch  | `{ urls: string[], type: "plain"\|"html"\|"markdown", selector?, max_chars?, wait_ms? }`                                                                                                                                 | Fetch up to 10 URLs in one call (cache-aware). Returns per-URL `{url, ok, content\|error}` — one failure never kills the batch.                                       |

**Returns**
- `type: plain`: Terminal-style, JS-executed readable text (or error string).
- `type: html`: Post-JS HTML markup string (or error string). With `selector`, only the matched element's HTML.
- `type: markdown`: Markdown conversion of the main content or selected element (or error string). Links, headings, lists, and page structure retained for AI-friendly context.
- `type: pdf`: extracted plain text from the PDF document (via pdftotext, 20 MB cap).
- Errors are **structured**: an MCP response with `isError: true` and a `FetchError` message that includes the HTTP status when knowable (never a silent empty string).

---

## Environment Variables

Set these via `.env` (loaded automatically) or the environment:

| Variable                    | Default       | Description                                                              |
|-----------------------------|---------------|--------------------------------------------------------------------------|
| `BROWSH_FIREFOX_PATH`       | `firefox`     | Firefox binary used by Browsh (e.g. `/usr/bin/firefox-esr`).             |
| `HTML2MARKDOWN_PATH`        | `html2markdown` | Path to the html2markdown binary.                                      |
| `BROWSH_REQUEST_TIMEOUT_MS` | `30000`       | Per-render request timeout (ms).                                          |
| `PDF_MAX_BYTES`             | `20971520`    | Max PDF file size in bytes for `fetch_web type: pdf`.                    |
| `BROWSH_RECYCLE_REQUESTS`   | `100`         | Number of requests after which the browser process is recycled.          |
| `BROWSH_IDLE_TIMEOUT_MS`    | `600000`      | Idle time in ms before the browser process is killed (10 min).           |
| `CACHE_TTL_MS`              | `300000`      | In-memory render cache TTL (ms).                                          |
| `ALLOW_PRIVATE_URLS`        | `false`       | Set `true` to disable the SSRF guard for loopback/private targets.        |
| `MCP_TRANSPORT`             | `stdio`       | Transport type (only `stdio` implemented).                                |
| `NODE_ENV`                  | `production`  | Node environment.                                                        |

---

## AI-Guided Tool Selection

- **Start with `search_web`:** To *discover* pages, run a query and pick the best result URLs; then fetch them.
- **Use `fetch_web` for single pages:** `plain` when you need quick readable output for summarization/classification; `html` to parse elements, links, or tables; `markdown` for LLM-friendly context chunks. Add `selector`/`max_chars`/`wait_ms` to stay token-efficient and get settled, relevant content.
- **Use `extract_links` before deep crawls:** Follow navigation cheaply instead of fetching full DOMs.
- **Use `fetch_web_batch` for multiple sources:** One call instead of N round-trips; failures are isolated per URL.

**Error handling:**
Tools throw `FetchError` and MCP returns `isError: true` with an actionable message — invalid protocols, SSRF blocks, unmatched selectors, HTTP status codes, and rendering failures are never silent.

---

## MCP Protocol: AI Client Configuration

> **Before configuring your AI client (Claude, Cursor, etc.), you must**
> 1. Install dependencies:
> &nbsp;&nbsp;&nbsp;`npm install`
> 2. Build the project:
> &nbsp;&nbsp;&nbsp;`npm run build`
> 3. Launch the MCP server from the compiled output:
> &nbsp;&nbsp;&nbsp;`node dist/server.js`

**Example config for Claude Desktop or Cursor:**
```json
{
  "mcpServers": {
    "blowsh": {
      "command": "node",
      "args": ["dist/server.js"],
      "env": {}
    }
  }
}
```

**Example config for opencode (project `opencode.json`):**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "blowsh": {
      "type": "local",
      "command": ["docker", "run", "--rm", "-i", "blowsh-mcp:latest"],
      "enabled": true,
      "timeout": 30000
    }
  },
  "permission": { "blowsh_*": "allow" }
}
```
The Docker form needs no host-side binaries; the image bundles Firefox, Browsh, and html2markdown. Restart opencode after saving (config is loaded once at startup).

---

## Graceful Shutdown

blowsh-mcp traps SIGINT/SIGTERM and ensures Browsh is terminated cleanly—no orphan browsers.

---

## Security and Considerations

- The server runs Browsh locally and fetches via HTTP localhost.
- **SSRF guard:** By default, `fetch_web`/`search_web`/`extract_links`/`fetch_web_batch` refuse URLs that resolve to loopback, private, link-local, or reserved IP ranges (checked over DNS). Set `ALLOW_PRIVATE_URLS=true` to disable — not recommended.
- No public exposure unless MCP HTTP/streamable server is explicitly configured.
- Never expose ports to open web without firewall.
- Use env vars for secrets/config.

---

## Extending

Add new tools in `src/tools/`, export them in `src/server.ts`, and document.  
AI clients will auto-discover docstrings.

---

## Troubleshooting

- If fetchPlain returns 404 or fails to render JS: check Firefox and Browsh are installed and in PATH.
- If Firefox is not found or fails to launch, set `BROWSH_FIREFOX_PATH` in `.env` to specify the full path to your Firefox install.
- Browsh port/host are fixed—there is no environment or CLI setting to change them.
- For maximum security, run in a container.

---

## License

MIT

---

**Author:** Mohammad Reza Mokhtarabadi <mmokhtarabadi@gmail.com>