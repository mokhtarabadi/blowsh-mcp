# Data Model

This document describes every MCP tool's input schema and output shape. The MCP wire format is JSON-RPC 2.0 over stdio;

## Response Envelope

- **Success:** `result.content[0] = { type: "text", text: <string> }`, `isError: false`.
- **Failure:** `isError: true`, `content[0].text` is a `FetchError` message (never a mock success string).
  - Format: `FetchError: <message> [http <status>]` when the HTTP status is known.

## Tools

### 1. `fetch_web`

**Input (`selectors.fetch_web`)**

| Field          | Type                  | Required | Constraints               |
|----------------|-----------------------|----------|---------------------------|
| `url`          | string                | yes      | `http(s)://`, SSRF-guarded |
| `type`         | `"plain"|"html"|"markdown"|"pdf"` | yes  | deterministic   |
| `selector`     | string (CSS)          | no       | first match only |
| `max_chars`    | number                | no       | 100..2_000_000 |
| `wait_ms`      | number                | no       | 0..60_000     |
| `focus`        | string                | no       | BM25 query — relevance filter |
| `toc`          | boolean               | no       | heading outline only |
| `section`      | string                | no       | heading substring (case-insensitive) |
| `must_contain` | string                | no       | probe: substring or `/regex/` |
| `archive`      | `"auto"|"only"|"off"` | no       | Wayback resurrection |
| `stitch`       | boolean               | no       | follow rel=next (markdown only) |
| `deadline_ms`  | integer               | no       | 500..600_000 hard budget (deadline.hit) |
| `tier`         | `"auto"|"1"|"2"`      | no       | auto / 1 HTTP-only / 2 browser-only |
| `links`        | boolean               | no       | include [text](url) (default true, false saves 30%) |
| `media`        | boolean               | no       | include ![alt](url)/<img> (default true) |
| `since_last`   | boolean               | no       | change check — one-liner if unchanged |
| `offset`       | integer               | no       | 0..10_000_000 resume from next_offset |

When `type: "pdf"`, `selector`, `max_chars`, `wait_ms`, `focus`, `toc`, `section`, `must_contain`, `archive`, `stitch`, `deadline_ms`, `tier`, `links`, `media`, `since_last`, `offset` are ignored and the
browser is bypassed entirely: the PDF is downloaded directly (SSRF-guarded,
size-capped via `PDF_MAX_BYTES`, default 20 MB) and piped through `pdftotext`.

**Output:** `text` = requested content shape:
- `plain` → readable terminal text (or `selector`'s text content).
- `html` → full post-JS DOM; with `selector`, that element's inner HTML.
- `markdown` → html2markdown output of the main content (`selector` or readability-extracted body).
- `pdf` → extracted plain text from the PDF document (via pdftotext).
- `toc=true` → heading outline only (`# Table of Contents` with `h1..h6` + char estimates), no body.
- `section="..."` → that heading's section markdown (heading + siblings until next heading of same/higher level). Throws `FetchError` if not found.
- `focus="query"` → BM25-lite filtered markdown (only blocks scoring >0.25) with header `> Focus filter ...`; falls back to full page with `[focus: no blocks matched ...]` notice when nothing matches.
- `must_contain="..."` → probe collapsed output: `MATCH` or `NO-MATCH` for pattern + ≤3 excerpts (`…context…`). Full fetch still happens; only output collapses (token saver ~60 vs 4k).
- `archive="auto"` → on hard failure (404/paywall/network) serves Wayback snapshot labeled `> [archive snapshot from YYYY-MM-DD via Wayback Machine ...]`; `archive="only"` goes straight to Wayback (throws `archive.stale` if none).
- `stitch=true` → follows `rel=next` up to 6 parts / 48k chars, returns stitched markdown with `*(part N)*` markers; same-host only.
- `deadline_ms` → hard budget 500-600000ms; on expiry throws `deadline.hit: fetch timed out after ...` with stable code.
- `tier="auto"|"1"|"2"` → `auto` (default, HTTP first → browser escalate), `1` HTTP-only, `2` browser-direct (skip sniff, always Browsh).
- `links=false` → strips `[text](url)` → `text` (saves ~30% tokens); `media=false` strips `![alt](url)` and `<img>`.
- `since_last=true` → fingerprint check (`blowsh-fetch-fingerprints.json`); unchanged → `unchanged since last fetch (fingerprint age)` one-liner; changed → `> [changed since last fetch — …]` banner.
- `offset=N` → skips N chars before `max_chars` truncation (resume via `next_offset` hint in DonSeTch parity).

### 2. `search_web`

**Input**

| Field            | Type    | Required | Constraints      |
|------------------|---------|----------|------------------|
| `query`          | string  | yes     | non-empty        |
| `max_results`    | integer | no      | 1..30, default 10 |
| `page`           | integer | no      | 1..10, default 1 |
| `enrich`         | boolean | no      | default false; top-3 snippets replaced with fetched markdown |
| `query_variants` | string[] | no     | max 2 alternate formulations, searched in parallel, merged |
| `intent`         | `"auto"|"web"|"code"|"paper"|"news"|"entity"` | no | default auto (detects) — code adds GitHub, paper arXiv, news HN, entity Wikipedia |
| `deadline_ms`    | integer | no      | 500..600_000, hard budget (honest deadline.hit error) |

Notes: `page` synthesizes engine-specific offsets (DDG 20/page, Bing/Brave/Mojeek 10/page). Engines (DDG, Bing, Brave, Mojeek) render concurrently and are merged by consensus (cross-engine agreement) rather than winner-takes-all; Brave/Mojeek add coverage beyond DDG/Bing. When DDG's Instant Answer API returns an abstract, a synthetic result with `url: ""` and `title: "Instant Answer"` is prepended; it counts toward `max_results`. `enrich: true` is best-effort — a failed enrichment fetch keeps the original snippet. `query_variants` are searched in parallel (up to 3 queries including base) and merged with dedup (flat array, backwards compatible). `intent` selects verticals (code→GitHub, paper→arXiv, news→HN Algolia, entity→Wikipedia opensearch) fetched via direct axios (no Browsh). `deadline_ms` races the whole search; on expiry throws `deadline.hit`.

**Output** `text` = pretty-printed JSON array:

```json
[
  { "title": "Browsh", "url": "https://www.brow.sh/", "snippet": "…", "fetched_at": 1754250000000 }
]
```

Each result carries `fetched_at` (UTC epoch milliseconds, per `docs/conventions.md`)
so consumers can assess staleness. The synthetic Instant Answer result uses the
same field. Engines are rendered concurrently and merged by consensus; an empty organic result set is
terminal success `[]`. Query cache (intent-aware TTL) dedups repeats.

### 3. `crawl_web`

**Input (`selectors.crawl_web`)**

| Field            | Type      | Required | Constraints |
|------------------|-----------|----------|-------------|
| `url`            | string    | yes      | http(s) seed, SSRF-guarded |
| `mode`           | `"full"|"map"|"content"` | no | default full (sitemap map + content) |
| `focus`          | string    | no       | BM25-lite topic — ranks frontier and filters pages |
| `max_pages`      | integer   | no       | 1..200, default 10 |
| `max_depth`      | integer   | no       | 0..10, default 2 (0=seed only) |
| `max_total_chars`| integer   | no       | 4000..500_000, default 60_000 |
| `per_page_max`   | integer   | no       | 400..40_000, default 8_000 |
| `include_paths`  | string[]  | no       | globs to include (e.g. ["/docs/*"]) |
| `exclude_paths`  | string[]  | no       | globs to exclude (merged with defaults: login, cart, tags, archive ...) |
| `same_host`      | boolean   | no       | default true |
| `respect_robots` | boolean   | no       | default true (reads Disallow + crawl-delay) |
| `deadline_s`     | integer   | no       | 5..600, default 120 |
| `resume`         | string    | no       | resume token (30 min disk-backed) |
| `since_last`     | boolean   | no       | delta: skip unchanged (<24h fingerprint) |

**Output** `text` = pretty-printed JSON object:

```json
{
  "seed": "https://docs.example.com",
  "pages": [
    { "url": "https://docs.example.com/a", "title": "Auth", "kind": "Docs", "markdown": "# Auth\n…", "chars": 3200, "quality": 0.82, "duplicate": false, "parent": "https://docs.example.com", "score": 1.5, "lastmod": "2026-08-10" }
  ],
  "map": ["https://docs.example.com/a", "https://docs.example.com/b"],
  "queued": ["https://docs.example.com/c"],
  "filtered_out": 0,
  "skipped": [{ "url": "https://docs.example.com/private", "reason": "robots disallow" }],
  "stop": "MaxPages",
  "elapsed_s": 12.3,
  "resume": "crawl_abc123",
  "crawl_delay": 1.0
}
```

`stop` values: `FrontierEmpty` (done), `MaxPages`, `CharBudget`, `DepthLimit`, `Deadline`, `ThrottledOut`, `Cancelled`. `resume` is non-null when stopped early with remaining queue (30 min TTL, file at `os.tmpdir()/blowsh-crawl-resumes.json`). `since_last` uses fingerprint file `blowsh-crawl-fingerprints.json` (<24h). Quality 0-1 (length + headings/code/table heuristics); kind `Article|Listing|Docs|Table|Page`.

### 4. `extract_links`

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

### 5. `fetch_web_batch`

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
- **Caching keys:** `url + settleKey(type, selector, wait_ms, focus, toc, section, must_contain, archive, stitch, tier, links, media, since_last, offset, deadline_ms)` for page renders; `url + ":links"` for link lists. Truncation (`max_chars`) is applied at read time; never cached truncated. Archive-only fetches use distinct key `archive-only|...`. `offset` is applied post-cache before truncation; `since_last` fingerprint file `blowsh-fetch-fingerprints.json` handled outside cache.
- **JS settle:** with `wait_ms > 0`, successive independent renders of the same URL are compared; if two consecutive DOMs are identical the render is considered settled.
- **Crawl resume:** tokens are `crawl_<ts>_<rand>` stored in `os.tmpdir()/blowsh-crawl-resumes.json`, swept on every use (30 min TTL), atomic write via rename.
- **Fraction of numbers:** duration/timestamps are in UTC ms (per `docs/conventions.md`).
