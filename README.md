# blowsh-mcp

**Model Context Protocol Server for JS-Capable Terminal Browsing with Browsh**

---

## What is blowsh-mcp?

blowsh-mcp is a Model Context Protocol (MCP) server that exposes the power of Browsh—a fully JavaScript-capable terminal browser—to any AI Agent, IDE agent, or MCP client. This project allows your AI to fetch and render any modern web page, including those requiring JavaScript, and receive the result as easily-parsed plain text, HTML, or Markdown.

Mnemonic: “blowsh” = Browsh-powered MCP server.

---

## Key Features

- **fetch_web Tool:** Unified tool for readable plain text, HTML, or Markdown extraction (after full JS rendering). Use for search, summarization, scraping, or LLM context from dynamic, JS-powered sites.
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

1. AI/Agent makes an MCP request via `fetch_web`, supplying a URL and output type (`plain`, `html`, or `markdown`).
2. blowsh-mcp launches Browsh in HTTP server mode (on first use) and reuses it for all later calls.
3. blowsh-mcp requests the raw output from Browsh, using `X-Browsh-Raw-Mode: PLAIN` (for text), `DOM` (for HTML), or fetches HTML and then converts to Markdown.
4. The page (after full JS execution) is returned as terminal plain text, rich HTML DOM, or clean Markdown—AI/agents pick the output type to match downstream processing.

---

## Example Usage

**From Claude, Cursor, or any MCP-enabled agent:**

```json
{
  "tool": "fetch_web",
  "params": { "url": "https://coindesk.com/price/bitcoin/", "type": "plain" }
}
// → Returns readable plain text (live price as text table, etc)

{
  "tool": "fetch_web",
  "params": { "url": "https://coindesk.com/price/bitcoin/", "type": "html" }
}
// → Returns after-JS-rendered HTML markup as string

{
  "tool": "fetch_web",
  "params": { "url": "https://coindesk.com/price/bitcoin/", "type": "markdown" }
}
// → Returns Markdown ("# Bitcoin Price\n\n| Time | Price | ...") suitable for direct LLM summarization, semantic search, or output formatting.
```
AI receives:
- With `type: plain`: pure readable text (tables, lists, main body content; ideal for NLP/summarization or terminal context ingestion).
- With `type: html`: the full HTML markup, after all JavaScript. Use for element parsing, link graph construction, complex scrapes, etc.
- With `type: markdown`: a clean Markdown version—best for LLM context chunks, semantic pipelines, and AI-friendly consumption/workflows.

---

## Project Structure

- `src/server.ts` — MCP server exposing tools.
- `src/browshManager.ts` — Launch, monitor, shutdown Browsh.
- `src/tools/fetchWeb.ts` — fetchWeb tool implementation (handles plain, html, markdown).
- `src/tools/html2markdownManager.ts` — Wrapper for html2markdown CLI.
- `README.md` — This file.
- `Dockerfile` — For container launch (installs html2markdown CLI automatically).
- `.env` — Config overrides. Set `BROWSH_FIREFOX_PATH` or `HTML2MARKDOWN_PATH` as needed.

---

## Installation

**Requirements:**  

- Node.js >= 18  
- Firefox installed and in PATH  
- [Browsh CLI](https://www.brow.sh/downloads/) installed and in PATH  
- [html2markdown CLI](https://github.com/JohannesKaufmann/html-to-markdown) installed and in PATH  
  - On Debian/Ubuntu, install with:
    ```sh
    wget -O /tmp/html2markdown.deb "https://github.com/JohannesKaufmann/html-to-markdown/releases/download/v2.3.3/html2markdown_2.3.3_linux_amd64.deb"
    sudo apt-get install -y /tmp/html2markdown.deb
    rm /tmp/html2markdown.deb
    ```
  - Or use the prebuilt binary for your OS from the [releases page](https://github.com/JohannesKaufmann/html-to-markdown/releases).

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
HTML2MARKDOWN_PATH=html2markdown
NODE_ENV=production
```
- `BROWSH_FIREFOX_PATH` lets you customize the Firefox executable used by Browsh during headless/HTTP operation.
- `HTML2MARKDOWN_PATH` lets you specify a custom path to the html2markdown binary (default: `html2markdown` in PATH).
- Browsh's HTTP port/host are NOT configurable.

---

## Tool API

| Name      | Params                                                                                 | AI Use-case/Description                                                                                                                                      |
|-----------|----------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| fetch_web | `{ url: string, type: "plain"\|"html"\|"markdown" }`                                   | Unified tool: Extracts readable, JS-rendered terminal plain text, full HTML DOM, or Markdown from the page. Use `type` to select output.                    |

**Returns**
- `type: plain`: Terminal-style, JS-executed readable text (or error string).
- `type: html`: Post-JS HTML markup string (or error string).
- `type: markdown`: Markdown conversion of DOM (or error string). Links, headings, lists, and page structure retained for AI-friendly context.

---

## AI-Guided Tool Selection

- **When to use `type: plain`:** You need quick, readable output for summarization, classification, or simple parsing—where table layout and detail matter more than markup.
- **When to use `type: html`:** You want to parse out elements, relationships, data tables, or navigation info, or need full control over page structure and links.
- **When to use `type: markdown`:** You want a Markdown-formatted context for chunking into LLMs, semantic search, retrieval-augmented generation, or for passing content to other AI chains. Markdown output mimics what AIs “see” in high-signal language tasks.

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