# Design System — MCP Response & Output Design Language

> Note: This is a headless server; the "UI" is the set of MCP tool outputs consumed by AI agents. This document defines the design language and formatting rules those outputs follow.

---

## 1. Design Principles

1. **Deterministic shapes** — Every tool returns one of a fixed set of shapes (text, JSON array). No inline convenience wrappers; a structure once, reuse everywhere.
2. **Machine-first, human-second** — LLMs are the consumer. Favor parseable, low-noise output over decorative formatting.
3. **Honest errors** — Errors are errors. Failures surface with `isError: true` and a precise message, never silently or as "success".
4. **Token economy** — Provide mechanisms to reduce payload (`selector`, `max_chars`) rather than dumbing down content.

## 2. Output Formatting Rules

- **Plain content:** raw extracted text, no framing markup. Whitespace preserved.
- **Markdown content:** standard Markdown produced by html2markdown (headings, lists, tables, links). No code fences added by the server.
- **Structured lists** (`search_web`, `extract_links`, `fetch_web_batch`): pretty-printed JSON with 2-space indent; keys ordered `title, url, snippet` / `text, url` / `url, ok, content|error`.
- **Truncation marker:** `…[truncated at N chars, M more]` appended on the final line when `max_chars` cuts output.

## 3. Error Style

- Prefix: `FetchError: <reason>`
- Optional suffix: `[http <status>]`
- Known categories (message phrasing):
  - `FetchError: URL must start with http:// or https://`
  - `FetchError: Unsupported protocol '<proto>' (only http/https)`
  - `FetchError: SSRF guard: refused to fetch private address '<addr>'`
  - `FetchError: CSS selector '<sel>' matched nothing`
  - `FetchError: Request failed with status <status>`
  - `FetchError: Browsh did not start in HTTP mode within timeout`
- Do not repeat stack traces in client-facing text.

## 4. Naming & Wording

- Tool names: `fetch_web`, `search_web`, `extract_links`, `fetch_web_batch` (snake_case per MCP convention).
- Argument names snake_case. Enums lowercase: `plain|html|markdown`.
- Status output: `ok: true|false` per item in batch results; never long.

## 5. Golden Path Example

```
{
  "tool": "search_web",
  "params": { "query": "…", "max_results": 5 }
}
→ [{"title":"…","url":"https://…","snippet":"…"}]
```

## 6. Constraints

- No UI screens, layouts, or colors — nothing here changes; do not add styling fields.
- Any new tool MUST register both a `ToolSchema` entry (README Tool API) and a `data_model.md` section; output must match one of the defined shapes or be added to the design system explicitly.