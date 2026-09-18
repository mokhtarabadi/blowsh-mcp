import dotenv from "dotenv";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { browshManager } from "./browshManager.js";
import { toFetchErrorMessage } from "./errors.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fetchWeb } from "./tools/fetchWeb.js";
import { searchWeb } from "./tools/searchWeb.js";
import { extractLinks } from "./tools/extractLinks.js";
import { fetchWebBatch } from "./tools/fetchWebBatch.js";
import { crawlWeb } from "./tools/crawlWeb.js";

dotenv.config({ quiet: true });

const tools = [
  ToolSchema.parse({
    name: "fetch_web",
    title: "Fetch Web (plain, html, markdown, pdf) — DonSeTch parity",
    description:
      "Fetch a web page and return its content as plain text, HTML, Markdown, or PDF-extracted text after full JS rendering. " +
      "Use `type` to select the output shape; `selector` (CSS) to extract only the matched element; " +
      "`max_chars` to cap output length; `wait_ms` to keep polling until the page's JavaScript has settled. " +
      "`type: \"pdf\"` downloads the PDF directly (SSRF-guarded, 20 MB cap) and extracts text via pdftotext — " +
      "`selector`, `max_chars`, and `wait_ms` are ignored for PDFs. " +
      "DonSeTch-parity extras: `focus` (BM25 relevance filter — cuts tokens 50-80%), `toc` (heading outline only), `section` (single section by heading), " +
      "`must_contain` (probe mode MATCH/NO-MATCH + excerpts, ~60 tokens), `archive` (auto/only/off Wayback resurrection), `stitch` (follow rel=next pagination up to 6 parts), " +
      "`deadline_ms` (hard budget), `tier` (auto/1/2), `links`/`media` (include/exclude), `since_last` (unchanged detection), `offset` (resume from next_offset).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The HTTP/HTTPS web URL to fetch" },
        type: { type: "string", enum: ["plain", "html", "markdown", "pdf"], description: "Output type: plain, html, markdown, or pdf (text)" },
        selector: { type: "string", description: "Optional CSS selector; only the matched element is returned (ignored for pdf)" },
        max_chars: { type: "number", description: "Optional cap on output length in characters (ignored for pdf)" },
        wait_ms: { type: "number", description: "Optional JS settle polling budget in ms (default 0 = single render; ignored for pdf)" },
        focus: { type: "string", description: "Relevance query: returns ONLY blocks that score against it (BM25), cutting tokens 50-80%. If nothing matches, returns full page with notice." },
        toc: { type: "boolean", description: "true = heading outline only, no body text. Use to read structure then target with section." },
        section: { type: "string", description: "Heading name (substring, case-insensitive): return only that section. Use after toc." },
        must_contain: { type: "string", description: "Probe mode: verify the page mentions a string/pattern WITHOUT loading full content into context. Returns MATCH/NO-MATCH + up to 3 excerpts. Case-insensitive substring, or /regex/ (e.g. \"/CVE-2026-\\d+/\"). Full fetch still happens internally; only output collapses." },
        archive: { type: "string", enum: ["auto", "only", "off"], description: "Wayback resurrection: auto (default when set): on hard failure (404/paywall/timeout/network) serve nearest archived snapshot labeled with date; when no snapshot exists the original error is rethrown unchanged; only: skip live fetch, go straight to archive; off: never." },
        stitch: { type: "boolean", description: "Multi-page articles: follow rel=next and return WHOLE article in one call (up to 6 parts / 48k chars) with *(part N)* markers, same-host only." },
        deadline_ms: { type: "number", description: "Hard time budget in ms (500-600000). On expiry: honest deadline.hit error, never a silent hang." },
        tier: { type: "string", enum: ["auto", "1", "2"], description: "auto (default): HTTP first, auto-escalates to browser. \"1\": HTTP only (no browser). \"2\": browser directly (slower, skips HTTP)." },
        links: { type: "boolean", description: "Include [text](url) link URLs. Default true (blowsh). Set false to save ~30% tokens (matches DonSeTch default false)." },
        media: { type: "boolean", description: "Include image alt text and sources. Default true. Set false to strip media." },
        since_last: { type: "boolean", description: "Change check instead of full read: if unchanged since last fetch of this URL, output collapses to one-line verdict (~30 tokens)." },
        offset: { type: "number", description: "Resume from a previous response's next_offset to continue a truncated page. Skips offset chars before truncating to max_chars." },
      },
      required: ["url", "type"],
    },
  }),
  ToolSchema.parse({
    name: "search_web",
    title: "Search the web — DonSeTch parity (multi-engine, intent, variants)",
    description:
      "Search the web through rendered search engines and return ranked results (title, url, snippet). " +
      "Engines: DuckDuckGo HTML, Bing, Brave, Mojeek (concurrently) fused by cross-engine consensus. " +
      "Use to discover pages, then feed URLs to fetch_web/extract_links. " +
      "DonSeTch-parity: `query_variants` (up to 2 alternate formulations, searched in parallel), `intent` (auto/web/code/paper/news/entity selects verticals: GitHub, Wikipedia, arXiv, HN), `deadline_ms` (hard budget: on expiry with zero data returns cheap-fallback partials or an honest deadline.hit error, never a bare empty result).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Max results to return (1-30, default 10)" },
        page: { type: "number", description: "Result page (1-10, default 1); offsets are synthesized per engine" },
        enrich: { type: "boolean", description: "When true, top-3 snippets are replaced with fetched markdown (best-effort)" },
        query_variants: { type: "array", items: { type: "string" }, description: "Optional alternate formulations of the same information need (max 2). Searched in parallel; results merged with dedup." },
        intent: { type: "string", enum: ["auto", "web", "code", "paper", "news", "entity"], description: "auto (default) detects from query. code: adds GitHub vertical; paper: arXiv; news: HN; entity: Wikipedia; web: general only." },
        deadline_ms: { type: "number", description: "Hard time budget in ms (500-600000). On expiry: honest deadline error, never a silent hang." },
      },
      required: ["query"],
    },
  }),
  ToolSchema.parse({
    name: "extract_links",
    title: "Extract links from a page",
    description:
      "Return the hyperlinks (text + absolute URL) found on the JS-rendered page. " +
      "Useful for following navigation without fetching the full DOM.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The HTTP/HTTPS web URL" },
        limit: { type: "number", description: "Max links to return (1-200, default 50)" },
      },
      required: ["url"],
    },
  }),
  ToolSchema.parse({
    name: "fetch_web_batch",
    title: "Fetch multiple web pages",
    description:
      "Fetch up to 10 URLs in one call, reusing the render cache. Returns per-URL results; a failing " +
      "URL does not fail the whole batch. deadline_ms is a per-item budget. focus/toc/section/archive/stitch " +
      "and other single-fetch options are not supported in batch.",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "1-10 HTTP/HTTPS URLs" },
        type: { type: "string", enum: ["plain", "html", "markdown"], description: "Output type" },
        selector: { type: "string", description: "Optional CSS selector applied to each page" },
        max_chars: { type: "number", description: "Optional per-page cap on output length" },
        wait_ms: { type: "number", description: "Optional JS settle polling budget (ms)" },
      },
      required: ["urls", "type"],
    },
  }),
  ToolSchema.parse({
    name: "crawl_web",
    title: "Crawl a site into markdown (sitemap-aware, focus-ranked, resumable)",
    description:
      "Crawl a site from a seed: for multi-page extraction (docs, API refs, wikis). Single page → fetch_web; finding sites → search_web. " +
      "Two-phase: sitemap discovery (cheap URL inventory) first, then focus-ranked page fetching with adaptive per-host pacing. " +
      "Modes: full (default)=map + content, map=URL inventory only (very cheap), content=BFS from seed, no sitemap. " +
      "Budgets: focus (topic) ranks frontier by BM25-lite and crawls only matches; max_pages / max_total_chars / deadline_s cap the run; resume tokens continue across calls. " +
      "Response: map + pages as markdown. structured: {seed, pages:[{url,title,kind,chars,quality}], map, queued, skipped, stop, elapsed_s, resume}. stop = FrontierEmpty (done) | MaxPages|CharBudget|DepthLimit|Deadline | ThrottledOut | Cancelled",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Seed http(s) URL to crawl from" },
        mode: { type: "string", enum: ["full", "map", "content"], description: "full (default): sitemap map + content, map: URL inventory only, content: skip sitemap, BFS from seed" },
        focus: { type: "string", description: "Relevance query: ranks frontier by keyword scoring and crawls only matching pages; fetched pages also filtered" },
        max_pages: { type: "number", description: "Max pages to fetch+extract (default 10, cap 200)" },
        max_depth: { type: "number", description: "Max link depth from seed (default 2). 0 = seed only." },
        max_total_chars: { type: "number", description: "Total extracted-char budget across all pages (default 60000, range 4000-500000)" },
        per_page_max: { type: "number", description: "Max markdown chars per page (default 8000, range 400-40000)" },
        include_paths: { type: "array", items: { type: "string" }, description: "Path globs to include (e.g. [\"/docs/*\"]). Empty = all." },
        exclude_paths: { type: "array", items: { type: "string" }, description: "Path globs to exclude (e.g. [\"*/tags/*\"])" },
        same_host: { type: "boolean", description: "Stay on seed's host (default true). false = follow cross-domain links." },
        respect_robots: { type: "boolean", description: "Obey robots.txt Disallow + crawl-delay (default true)" },
        deadline_s: { type: "number", description: "Hard crawl deadline in seconds (default 120, range 5-600). Partial results return after." },
        resume: { type: "string", description: "Resume token from a previous response to continue a stopped crawl. Valid for 30 min." },
        since_last: { type: "boolean", description: "Delta crawl: skip pages unchanged since last crawl (<24h fingerprint) — only new/changed pages fetched" },
      },
      required: ["url"],
    },
  }),
] as const;

type ToolName = (typeof tools)[number]["name"];

const selectors = {
  fetch_web: z.object({
    url: z.string(),
    type: z.enum(["plain", "html", "markdown", "pdf"]),
    selector: z.string().optional(),
    max_chars: z.number().int().min(100).max(2_000_000).optional(),
    wait_ms: z.number().int().min(0).max(60_000).optional(),
    focus: z.string().optional(),
    toc: z.boolean().optional(),
    section: z.string().optional(),
    must_contain: z.string().optional(),
    archive: z.enum(["auto", "only", "off"]).optional(),
    stitch: z.boolean().optional(),
    deadline_ms: z.number().int().min(500).max(600_000).optional(),
    tier: z.enum(["auto", "1", "2"]).optional(),
    links: z.boolean().optional(),
    media: z.boolean().optional(),
    since_last: z.boolean().optional(),
    offset: z.number().int().min(0).max(10_000_000).optional(),
  }),
  search_web: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(30).optional(),
    page: z.number().int().min(1).max(10).optional(),
    enrich: z.boolean().optional(),
    query_variants: z.array(z.string()).max(2).optional(),
    intent: z.enum(["auto", "web", "code", "paper", "news", "entity"]).optional(),
    deadline_ms: z.number().int().min(500).max(600_000).optional(),
  }),
  extract_links: z.object({
    url: z.string(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  fetch_web_batch: z.object({
    urls: z.array(z.string()).min(1).max(10),
    type: z.enum(["plain", "html", "markdown"]),
    selector: z.string().optional(),
    max_chars: z.number().int().min(100).max(2_000_000).optional(),
    wait_ms: z.number().int().min(0).max(60_000).optional(),
    deadline_ms: z.number().int().min(500).max(600_000).optional(),
  }),
  crawl_web: z.object({
    url: z.string(),
    mode: z.enum(["full", "map", "content"]).optional(),
    focus: z.string().optional(),
    max_pages: z.number().int().min(1).max(200).optional(),
    max_depth: z.number().int().min(0).max(10).optional(),
    max_total_chars: z.number().int().min(4000).max(500_000).optional(),
    per_page_max: z.number().int().min(400).max(40_000).optional(),
    include_paths: z.array(z.string()).optional(),
    exclude_paths: z.array(z.string()).optional(),
    same_host: z.boolean().optional(),
    respect_robots: z.boolean().optional(),
    deadline_s: z.number().int().min(5).max(600).optional(),
    resume: z.string().optional(),
    since_last: z.boolean().optional(),
  }),
} satisfies Record<ToolName, z.ZodType>;

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: false };
}

function errorResponse(error: unknown) {
  return { content: [{ type: "text" as const, text: toFetchErrorMessage(error) }], isError: true };
}

async function route(name: ToolName, args: unknown): Promise<string> {
  switch (name) {
    case "fetch_web": {
      const { url, type, selector, max_chars, wait_ms, focus, toc, section, must_contain, archive, stitch, deadline_ms, tier, links, media, since_last, offset } = selectors.fetch_web.parse(args);
      return fetchWeb({ url, type, selector, max_chars, wait_ms, focus, toc, section, must_contain, archive, stitch, deadline_ms, tier, links, media, since_last, offset });
    }
    case "search_web": {
      const { query, max_results, page, enrich, query_variants, intent, deadline_ms } = selectors.search_web.parse(args);
      return JSON.stringify(
        await searchWeb(query, max_results ?? 10, page ?? 1, enrich ?? false, query_variants, intent, deadline_ms),
        null,
        2
      );
    }
    case "extract_links": {
      const { url, limit } = selectors.extract_links.parse(args);
      return JSON.stringify(await extractLinks(url, limit), null, 2);
    }
    case "fetch_web_batch": {
      const { urls, type, selector, max_chars, wait_ms, deadline_ms } = selectors.fetch_web_batch.parse(args);
      return JSON.stringify(await fetchWebBatch({ urls, type, selector, max_chars, wait_ms, deadline_ms }), null, 2);
    }
    case "crawl_web": {
      const { url, mode, focus, max_pages, max_depth, max_total_chars, per_page_max, include_paths, exclude_paths, same_host, respect_robots, deadline_s, resume, since_last } = selectors.crawl_web.parse(args);
      return JSON.stringify(
        await crawlWeb({ url, mode, focus, max_pages, max_depth, max_total_chars, per_page_max, include_paths, exclude_paths, same_host, respect_robots, deadline_s, resume, since_last }),
        null,
        2
      );
    }
    default:
      throw new Error(`Unhandled tool: ${name}`);
  }
}

async function runServer() {
  const server = new Server(
    {
      name: "blowsh-mcp",
      version: "2.3.2",
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.slice() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const toolName = name as ToolName;
    if (!(toolName in selectors)) {
      return errorResponse(new Error(`Tool '${name}' not found.`));
    }
    try {
      return textResponse(await route(toolName, request.params.arguments));
    } catch (error) {
      return errorResponse(error);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("blowsh-mcp MCP server running on stdio");

  // Boot prewarm (BROWSH_PREWARM=0 disables): bring the browser up at server
  // start so the first tool call never pays the ~40s cold start. Fire-and-
  // forget — a failed prewarm only logs; tools lazily start on demand.
  if (process.env.BROWSH_PREWARM !== "0") {
    void browshManager
      .prewarm()
      .catch((e) =>
        console.error("[browshManager] boot prewarm failed (lazy start still active):", e instanceof Error ? e.message : String(e))
      );
  }

  const shutdown = async (signal?: string | Error) => {
    try {
      await browshManager.shutdown();
      if (signal) console.error(`Gracefully shutting down (reason: ${signal})`);
    } catch (e) {
      console.error("Shutdown error:", e);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT").then(() => process.exit(0)));
  process.on("SIGTERM", () => shutdown("SIGTERM").then(() => process.exit(0)));
  process.on("exit", () => void shutdown("process exit"));
  process.on("uncaughtException", (err) => {
    void shutdown(err).then(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    void shutdown(reason instanceof Error ? reason : new Error(String(reason))).then(() => process.exit(1));
  });
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
