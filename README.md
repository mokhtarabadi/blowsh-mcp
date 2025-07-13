# blowsh-mcp

**Model Context Protocol Server for JS-Capable Terminal Browsing with Browsh**

---

## What is blowsh-mcp?

blowsh-mcp is a Model Context Protocol (MCP) server that exposes the power of Browsh—a fully JavaScript-capable terminal browser—to any AI Agent, IDE agent, or MCP client. This project allows your AI to fetch and render any modern web page, including those requiring JavaScript, and receive the result as easily-parsed plain text.

Mnemonic: “blowsh” = Browsh-powered MCP server.

---

## Key Features

- **fetch_plain Tool:** Readable plain text extraction (after full JS rendering). Use for search and summarization from dynamic, JS-powered sites.
- **fetch_html Tool:** Post-JavaScript, real DOM/HTML output for parsing, scraping, or navigation tree extraction.
- **fetch_markdown Tool:** Clean Markdown conversion from the JS-rendered HTML for optimal AI large context, semantic search, or direct context ingestion. Especially powerful for LLM pipelines.
- **AI-optimized tool documentation:** Inputs, outputs, and illustrated use-cases designed for seamless agent automation.
- **Robust Browsh management:** Launches Browsh once, keeps it running, graceful shutdown on exit.
- **Designed for PaaS, Cloud, Local AI tools, and IDE agents.**

---

## Links

- [Browsh CLI Browser](https://www.brow.sh/) — The rendering engine.
- [Firefox](https://www.mozilla.org/en-US/firefox/new/) — Required as the backend for Browsh.
- [Model Context Protocol (MCP) Specification](https://github.com/modelcontextprotocol/spec) — The agent/server protocol.

---

## How it Works

1. AI/Agent makes an MCP request via `fetchPlain`, `fetchHtml`, or `fetchMarkdown`, supplying a URL.
2. blowsh-mcp launches Browsh in HTTP server mode (on first use) and reuses it for all later calls.
3. blowsh-mcp requests the raw output from Browsh, using `X-Browsh-Raw-Mode: PLAIN` (for text), `DOM` (for HTML), or fetches HTML and then converts to Markdown.
4. The page (after full JS execution) is returned as terminal plain text, rich HTML DOM, or clean Markdown—AI/agents pick the tool to match downstream processing.

---

## Example Usage

**From Claude, Cursor, or any MCP-enabled agent:**

```json
{
  "tool": "fetch_plain",
  "params": { "url": "https://coindesk.com/price/bitcoin/" }
}
// → Returns readable plain text (live price as text table, etc)

{
  "tool": "fetch_html",
  "params": { "url": "https://coindesk.com/price/bitcoin/" }
}
// → Returns after-JS-rendered HTML markup as string

{
  "tool": "fetch_markdown",
  "params": { "url": "https://coindesk.com/price/bitcoin/" }
}
// → Returns Markdown ("# Bitcoin Price\n\n| Time | Price | ...") suitable for direct LLM summarization, semantic search, or output formatting.
```
AI receives:
- With `fetchPlain`: pure readable text (tables, lists, main body content; ideal for NLP/summarization or terminal context ingestion).
- With `fetchHtml`: the full HTML markup, after all JavaScript. Use for element parsing, link graph construction, complex scrapes, etc.
- With `fetchMarkdown`: a clean Markdown version—best for LLM context chunks, semantic pipelines, and AI-friendly consumption/workflows.

---

## Project Structure

- `src/server.ts` — MCP server exposing tools.
- `src/browshManager.ts` — Launch, monitor, shutdown Browsh.
- `src/tools/fetchPlain.ts` — fetchPlain tool implementation.
- `src/tools/fetchHtml.ts` — fetchHtml (DOM/HTML) tool implementation.
- `README.md` — This file.
- `Dockerfile` — For container launch.
- `.env` — Config overrides. Set `BROWSH_FIREFOX_PATH` if you need to specify a custom Firefox binary for Browsh (`firefox` by default). Browsh server port/host cannot be set; it is fixed.

---

## Installation

**Requirements:**  
- Node.js >= 18  
- Firefox installed and in PATH  
- [Browsh CLI](https://www.brow.sh/downloads/) installed and in PATH  

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
BROWSH_FIREFOX_PATH=/usr/bin/firefox
NODE_ENV=production
```
- `BROWSH_FIREFOX_PATH` lets you customize the Firefox executable used by Browsh during headless/HTTP operation.
- Browsh's HTTP port/host are NOT configurable.

---

## Tool API

| Name           | Params           | AI Use-case/Description                                                                                                         |
|----------------|------------------|-------------------------------------------------------------------------------------------------------------------------------|
| fetch_plain    | { url: string }  | Extracts readable, JS-rendered terminal plain text from the page. Use this for NLP, summarization, or non-markup scrapes.      |
| fetch_html     | { url: string }  | Returns full, after-JS HTML DOM. Choose for web scraping needing markup, page structure analysis, data tables, or extraction.   |
| fetch_markdown | { url: string }  | Converts the JS-rendered DOM to Markdown. Best for LLM context, semantic AI search, or direct context chunking.                |

**Returns**
- fetch_plain: Terminal-style, JS-executed readable text (or error string)
- fetch_html: Post-JS HTML markup string (or error string)
- fetch_markdown: Markdown conversion of DOM (or error string). Links, headings, lists, and page structure retained for AI-friendly context.

---
## AI-Guided Tool Selection

- **When to use `fetch_plain`:** You need quick, readable output for summarization, classification, or simple parsing—where table layout and detail matter more than markup.
- **When to use `fetch_html`:** You want to parse out elements, relationships, data tables, or navigation info, or need full control over page structure and links.
- **When to use `fetch_markdown`:** You want a Markdown-formatted context for chunking into LLMs, semantic search, retrieval-augmented generation, or for passing content to other AI chains. Markdown output mimics what AIs “see” in high-signal language tasks.

**Error handling:**
Every tool returns actionable errors: e.g., invalid protocol, 404s, rendering failures—never silent.

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

---

## Graceful Shutdown

blowsh-mcp traps SIGINT/SIGTERM and ensures Browsh is terminated cleanly—no orphan browsers.

---

## Security and Considerations

- The server runs Browsh locally and fetches via HTTP localhost.
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