# src/tools — MCP tool handlers

One file per tool. Each handler validates with zod, calls `assertSafeUrl` first, and returns the shape in `docs/data_model.md`.

| File | Tool | Notes |
| --- | --- | --- |
| `fetchWeb.ts` | `fetch_web` | plain/html/markdown/pdf + selector, focus, toc/section, must_contain, archive, stitch, tier, links/media, since_last, offset |
| `searchWeb.ts` | `search_web` | Google-first tiered fallback → Startpage → 4-engine consensus + verticals; `SEARCH_DEADLINE_MS` default budget (explicit `deadline_ms` wins), `ENRICH_BUDGET_MS` bounds enrich, per-engine block breaker skips dead tiers |
| `crawlWeb.ts` | `crawl_web` | Sitemap-aware crawl, Governor pacing, resume tokens, fingerprints |
| `extractLinks.ts` | `extract_links` | Hyperlinks from rendered DOM |
| `extractPdf.ts` | (pdf path) | SSRF-guarded download → pdftotext, size-capped |
| `fetchWebBatch.ts` | `fetch_web_batch` | Up to 10 URLs, per-URL `{ok, content|error}`, per-item `deadline_ms` |

Batch supports only the documented subset — single-fetch options stay single-fetch by contract.

## Empty-extraction contract (`fetch_web`)

A render that produces no usable text is an error, never a success body.

- **Guard:** `guardEmptyExtraction(content, { url, type, domChars, source })` in `fetchWeb.ts` throws `FetchError` with code `empty.extraction` and the message `empty extraction for <url> via <source> [dom N chars, text M chars]`. `hasUsableExtraction()` holds the per-type rule.
- **Single exit:** `render()` guards the result of `renderOnce()`, so every renderer branch (Browsh plain/DOM, HTTP-only, non-HTML direct, enhanced `processDomForType`) is covered. The stitch, archive-snapshot, and pdf paths bypass `render()` and call the same guard themselves.
- **Type rule:** `markdown`/`plain`/`pdf` fail on whitespace-only output or output with no readable text (`hasReadableText()`); `type: "html"` fails only on a blank DOM, because its payload is markup.
- **Fallback:** markdown conversion retries once from the full DOM (`convertMarkdownWithRetry`) when the readability pass narrowed to an empty shell while the DOM still held text, and only then fails.
- **Cache:** `pageCache` stores only content the guard already accepted; an empty body is never cached.

## Search budgets and the render queue (`search_web`)

A search is a chain of renders, and every render goes through one serialized browser slot. Without an explicit bound on that chain, a "parallel" search degrades into a long serial queue and the caller sees a hang.

- **Two budgets, not one.** `BROWSH_REQUEST_TIMEOUT_MS` (default 180000 ms) bounds one render, and `BROWSH_QUEUE_TIMEOUT_MS` (default 600000 ms) bounds how long a render may wait behind the slot before it fails honestly. The per-render timeout only starts once the slot is granted, so the queue budget is what makes the chain bounded end to end.
- **Queue wait is abortable.** `RenderQueue` in `browshManager.ts` takes the request's `AbortSignal`. A waiter whose signal fires leaves the queue marked `aborted`; `release()` skips it, so the slot is handed to a live waiter instead of deadlocking.
- **Search deadline.** `search_web` runs under a wall-clock budget: the caller's `deadline_ms` when given, otherwise `SEARCH_DEADLINE_MS` (default 900000 ms, ceiling 1800000 ms). On expiry the in-flight renders are aborted — so a timed-out search stops holding the browser slot — and the call returns cheap-fallback partials or an honest `deadline.hit`.
- **The budgets form a ladder.** `SEARCH_DEADLINE_MS` ≥ `BROWSH_QUEUE_TIMEOUT_MS` + `BROWSH_REQUEST_TIMEOUT_MS`, and the queue funds at least two renders. Raising one knob alone breaks the chain: a search budget below queue + render aborts renders that were still legitimately queued, which is the failure this design exists to prevent. `tests/search-timeout-hardening-tests.ts` asserts the invariant, so a bad edit fails there rather than in production.
- **Blocked-engine breaker.** An engine whose page matched `isBlockedPage()` is remembered as blocked for `SEARCH_BLOCKED_ENGINE_TTL_MS` (default 10 min). Known-dead tiers are skipped instead of costing a serialized render on every query, which is the main saving for parallel `query_variants` searches. The breaker may only skip an engine while another candidate is untried, so it can never turn a working search into an empty one.
- **Enrichment stays in budget.** The enrichment phase is clamped to the remaining search budget, and each enrichment fetch inherits that remaining window.

