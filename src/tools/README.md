# src/tools — MCP tool handlers

One file per tool. Each handler validates with zod, calls `assertSafeUrl` first, and returns the shape in `docs/data_model.md`.

| File | Tool | Notes |
| --- | --- | --- |
| `fetchWeb.ts` | `fetch_web` | plain/html/markdown/pdf + selector, focus, toc/section, must_contain, archive, stitch, tier, links/media, since_last, offset |
| `searchWeb.ts` | `search_web` | Google-first tiered fallback → Startpage → 4-engine consensus + verticals; `ENRICH_BUDGET_MS` bounds enrich |
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

