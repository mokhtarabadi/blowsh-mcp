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
