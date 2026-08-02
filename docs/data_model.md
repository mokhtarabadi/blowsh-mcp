# Data Model

This document describes every MCP tool's input schema and output shape. The MCP wire format is JSON-RPC 2.0 over stdio;

## Response Envelope

- **Success:** `result.content[0] = { type: "text", text: <string> }`, `isError: false`.
- **Failure:** `isError: true`, `content[0].text` is a `FetchError` message (never a mock success string).
  - Format: `FetchError: <message> [http <status>]` when the HTTP status is known.

## Tools

### 1. `fetch_web`

**Input (`selectors.fetch_web`)**

| Field       | Type                  | Required | Constraints               |
|-------------|-----------------------|----------|---------------------------|
| `url`       | string                | yes      | `http(s)://`, SSRF-guarded |
| `type`      | `"plain"|"html"|"markdown"` | yes  | deterministic   |
| `selector`  | string (CSS)          | no       | first match only |
| `max_chars` | number                | no       | 100..2_000_000 |
| `wait_ms`   | number                | no       | 0..60_000     |

**Output:** `text` = requested content shape:
- `plain` → readable terminal text (or `selector`'s text content).
- `html` → full post-JS DOM; with `selector`, that element's inner HTML.
- `markdown` → html2markdown output of the main content (`selector` or readability-extracted body).

### 2. `search_web`

**Input**

| Field          | Type    | Required | Constraints      |
|----------------|---------|----------|------------------|
| `query`        | string  | yes   | non-empty        |
| `max_results`  | integer | no    | 1..30, default 10 |

**Output** `text` = pretty-printed JSON array:

```json
[
  { "title": "Browsh", "url": "https://www.brow.sh/", "snippet": "…" }
]
```

### 3. `extract_links`

**Input**

| Field   | Type    | Default | Constraints        |
|---------|---------|---------|---------------------|
| `url`   | string  | –       | SSRF-guarded, http(s) |
| `limit` | integer | 50      | 1..200             |

**Output** `text` = pretty-printed JSON array:

```json
[
  { "text": "Learn more", "url": "https://iana.org/domains/example" }
]
```
Internal de-duplication applied; `javascript:`/`mailto:`/`tel:`/`data:`/`blob:`/`#` hrefs are dropped; relative URLs are absolutized against the page URL.

### 4. `fetch_web_batch`

**Input**

| Field       | Type             | Required | Constraints      |
|-------------|------------------|----------|------------------|
| `urls`      | string[]         | yes     | 1..10 urls         |
| `type`      | enum (as fetch_web) | yes    |        |
| `selector`  | string           | no      |  |
| `max_chars` | integer          | no      |  | 
| `wait_ms`   | integer          | no      |  |

**Output** `text` = pretty-printed JSON array, per-URL result (a single bad URL never fails the batch):

```json
[
  { "url": "https://example.com", "ok": true, "content": "# Example Domain\n…" },
  { "url": "http://127.0.0.1:4333/", "ok": false, "error": "FetchError: SSRF guard: refused to fetch private address '127.0.0.1'" }
]
```

## Shared Data Rules

- **URLs:** absolute, `http(s)`; relative resolved against the source page; extracted links are absolute.
- **Caching keys:** `url + settleKey(type, selector, wait_ms)` for page renders; `url + ":links"` for link lists. Truncation (`max_chars`) is applied at read time; never cached truncated.
- **JS settle:** with `wait_ms > 0`, successive independent renders of the same URL are compared; if two consecutive DOMs are identical the render is considered settled.
- **Fraction of numbers:** duration/timestamps are in UTC ms (per `docs/conventions.md`).