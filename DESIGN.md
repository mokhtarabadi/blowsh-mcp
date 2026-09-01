# Design System — MCP Response & Output Design Language

> Note: This is a headless server; the "UI" is the set of MCP tool outputs consumed by AI agents. This document defines the design language and formatting rules those outputs follow.

---

## 1. Design Principles

1. **Deterministic shapes** — Every tool returns one of a fixed set of shapes (text, JSON array). No inline convenience wrappers; a structure once, reuse everywhere.
2. **Machine-first, human-second** — LLMs are the consumer. Favor parseable, low-noise output over decorative formatting.
3. **Honest errors** — Errors are errors. Failures surface with `isError: true` and a precise message, never silently or as "success".
4. **Token economy** — Provide mechanisms to reduce payload (`selector`, `max_chars`, `focus`, `toc`/`section`, `must_contain` probe, `links`/`media` toggles) rather than dumbing down content.

## 2. Output Formatting Rules

- **Plain content:** raw extracted text, no framing markup. Whitespace preserved.
- **Markdown content:** standard Markdown produced by html2markdown (headings, lists, tables, links). No code fences added by the server.
- **Structured lists** (`search_web`, `extract_links`, `fetch_web_batch`, `crawl_web`): pretty-printed JSON with 2-space indent; keys ordered `title, url, snippet` / `text, url` / `url, ok, content|error` / crawl `seed, pages, map, queued, skipped, stop`.
- **Truncation marker:** `…[truncated at N chars, M more]` appended on the final line when `max_chars` cuts output.
- **Focus marker:** `> Focus filter "query" kept X/Y blocks (~Z% reduction)` prepended when `focus` is active.
- **Archive banner:** `> [archive snapshot from YYYY-MM-DD via Wayback Machine ...]` prepended when `archive` serves a Wayback copy.
- **Stitch marker:** `---` + `*(part N)* from URL` between stitched parts when `stitch=true`.
- **Probe verdict:** `MATCH` or `NO-MATCH` + `1. …excerpt…` lines when `must_contain` is set (probe collapses full content).
- **TOC shape:** `# Table of Contents` + bullet lines `- heading (hN, ~chars)`.
- **Links toggle:** when `links=false`, `[text](url)` → `text` (via `stripLinks`), `_no reference_`.
- **Media toggle:** when `media=false`, `![alt](url)` and `<img>` removed (via `stripMedia`).
- **Since-last banner:** `unchanged since last fetch (fingerprint age)` one-liner when `since_last=true` and hash matches; `> [changed since last fetch — …]` when changed.
- **Offset handling:** `offset=N` skips first N chars before `max_chars` truncation (resume via DonSeTch `next_offset` parity).

## 3. Error Style

- Prefix: `FetchError: <reason>`
- Optional suffix: `[http <status>]`
- Known categories (message phrasing):
  - `FetchError: URL must start with http:// or https://`
  - `FetchError: Unsupported protocol '<proto>' (only http/https)`
  - `FetchError: SSRF guard: refused to fetch private address '<addr>'`
  - `FetchError: CSS selector '<sel>' matched nothing`
  - `FetchError: Section '<heading>' not found (no heading matched)`
  - `FetchError: Request failed with status <status>`
  - `FetchError: Browsh did not start in HTTP mode within timeout`
  - `FetchError: archive.stale: no Wayback snapshot for <url> [archive=only]`
  - `FetchError: deadline.hit: search timed out after <ms>ms (query: ...)`
  - `FetchError: deadline.hit: fetch timed out after <ms>ms for <url>`
  - `FetchError: resume token expired or unknown: <token>`
- Do not repeat stack traces in client-facing text.

## 4. Naming & Wording

- Tool names: `fetch_web`, `search_web`, `crawl_web`, `extract_links`, `fetch_web_batch` (snake_case per MCP convention).
- Argument names snake_case. Enums lowercase: `plain|html|markdown`, `auto|only|off`, `full|map|content`, `auto|web|code|paper|news|entity`, `auto|1|2`.
- Status output: `ok: true|false` per item in batch results; `stop: FrontierEmpty|MaxPages|CharBudget|DepthLimit|Deadline|ThrottledOut`; never long.

## 5. Golden Path Example

```
{
  "tool": "search_web",
  "params": { "query": "…", "max_results": 5 }
}
→ [{"title":"…","url":"https://…","snippet":"…"}]

{
  "tool": "fetch_web",
  "params": { "url": "https://example.com", "type": "markdown", "focus": "pricing" }
}
→ "> Focus filter \"pricing\" kept 3/12 blocks (~70% reduction)\n\n# Pricing\n…"

{
  "tool": "fetch_web",
  "params": { "url": "https://example.com", "type": "markdown", "links": false, "since_last": true }
}
→ "unchanged since last fetch (https://example.com, fingerprint abc, age 0.2h)" OR full markdown without links

{
  "tool": "crawl_web",
  "params": { "url": "https://docs.example.com", "mode": "map" }
}
→ {"seed":"…","map":["…"],"pages":[],"stop":"FrontierEmpty", …}
```

## 6. Constraints

- No UI screens, layouts, or colors — nothing here changes; do not add styling fields.
- Any new tool MUST register both a `ToolSchema` entry (README Tool API) and a `data_model.md` section; output must match one of the defined shapes or be added to the design system explicitly.
