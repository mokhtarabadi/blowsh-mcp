import { load } from "cheerio";
import axios from "axios";
import { browshManager } from "../browshManager.js";
import { assertSafeUrl } from "../ssrf.js";
import { FetchError } from "../errors.js";
import { fetchWeb } from "./fetchWeb.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** UTC epoch milliseconds when this result set was fetched (staleness signal). */
  fetched_at: number;
}

/** Total wall-clock budget for the enrichment phase (ms). */
const ENRICH_BUDGET_MS = 45_000;

// Simple in-memory query cache (intent-aware)
const queryCache = new Map<string, { at: number; results: SearchResult[] }>();

function cacheKeyForQuery(q: string, intent: string): string {
  return `${intent}|${q.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function intentCacheTtl(intent: string, query: string): number {
  const recency = ["latest", "today", "breaking", "recent", "price", "stock", "weather", "2026", "2025"];
  const lc = query.toLowerCase();
  if (recency.some((s) => lc.includes(s))) return 300_000;
  if (intent === "news") return 300_000;
  if (intent === "code") return 900_000;
  return 1_800_000;
}

/**
 * Decodes search-engine redirect wrappers to extract the real destination URL.
 * Handles: DuckDuckGo (`uddg` param), Bing (`u` base64 param), Google (`/url?q=`).
 * Returns the original href if no known pattern matches or decoding fails.
 */
function decodeRedirect(href?: string): string | undefined {
  if (!href) return href;

  // DuckDuckGo: https://duckduckgo.com/l/?uddg=<encoded-url>
  if (href.includes("duckduckgo.com/l/")) {
    try {
      const u = new URL(href.startsWith("//") ? `https:${href}` : href);
      const target = u.searchParams.get("uddg");
      if (target && /^https?:\/\//i.test(target)) return target;
    } catch { /* fall through */ }
    return href;
  }

  // Bing: https://www.bing.com/ck/a?...&u=<base64url>...
  if (href.includes("bing.com/ck/a")) {
    try {
      const u = new URL(href);
      const encoded = u.searchParams.get("u");
      if (encoded) {
        // Bing prefixes the base64 payload with a 2-byte version tag (e.g. "a1").
        // Strip it before decoding so the result is a clean URL.
        const raw = encoded.length > 2 && !encoded.startsWith("http") ? encoded.slice(2) : encoded;
        // Bing uses URL-safe base64 (no padding, - instead of +, _ instead of /)
        const std = raw.replace(/-/g, "+").replace(/_/g, "/");
        const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
        const decoded = Buffer.from(padded, "base64").toString("utf-8");
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    } catch { /* fall through */ }
    return href;
  }

  // Google: https://www.google.com/url?q=<encoded-url>&...
  if (href.includes("google.com/url")) {
    try {
      const u = new URL(href);
      const target = u.searchParams.get("q");
      if (target && /^https?:\/\//i.test(target)) return target;
    } catch { /* fall through */ }
    return href;
  }

  return href;
}

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** DuckDuckGo HTML URL for a given result page (20 results per page). */
function ddgSearchUrl(query: string, page: number): string {
  const s = (page - 1) * 20;
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${s}`;
}

/** Bing search URL for a given result page (10 results per page). */
function bingSearchUrl(query: string, page: number): string {
  const first = (page - 1) * 10 + 1;
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${first}&count=10`;
}

/** Brave search URL (10 results per page, offset param). */
function braveSearchUrl(query: string, page: number): string {
  const offset = (page - 1) * 10;
  return `https://search.brave.com/search?q=${encodeURIComponent(query)}&offset=${offset}`;
}

/** Mojeek search URL */
function mojeekSearchUrl(query: string, page: number): string {
  const s = (page - 1) * 10 + 1;
  return `https://www.mojeek.com/search?q=${encodeURIComponent(query)}&s=${s}`;
}

/** Parses DuckDuckGo HTML (html.duckduckgo.com) results. */
function parseDuckDuckGo(html: string, baseUrl: string): SearchResult[] {
  const $ = load(html);
  const results: SearchResult[] = [];
  $(".result").each((_, el) => {
    const link = $(el).find(".result__a").first();
    const snippet = $(el).find(".result__snippet").first().text().trim();
    const href = decodeRedirect(link.attr("href"));
    const abs = absolute(href, baseUrl);
    if (!abs) return;
    results.push({ title: link.text().trim() || abs, url: abs, snippet, fetched_at: 0 });
  });
  return results;
}

/** Parses Bing organic results. */
function parseBing(html: string, baseUrl: string): SearchResult[] {
  const $ = load(html);
  const results: SearchResult[] = [];
  $("li.b_algo").each((_, el) => {
    const a = $(el).find("h2 a").first();
    const snippet = $(el).find(".b_caption p, p").first().text().trim();
    const raw = a.attr("href");
    const decoded = decodeRedirect(raw);
    const abs = absolute(decoded, baseUrl);
    if (!abs) return;
    results.push({ title: a.text().trim() || abs, url: abs, snippet, fetched_at: 0 });
  });
  return results;
}

/** Parses Brave search results (best-effort, multiple selectors). */
function parseBrave(html: string, baseUrl: string): SearchResult[] {
  const $ = load(html);
  const results: SearchResult[] = [];
  // Brave uses varied selectors across layouts — try several
  const containers = $(".snippet, .result, [data-type='web'], .card, #results .result");
  if (containers.length > 0) {
    containers.each((_, el) => {
      const a = $(el).find("a").first();
      // Brave may have title in .snippet-title or .result-header
      const title = $(el).find(".snippet-title, .result-header, a").first().text().trim() || a.text().trim();
      const snippet = $(el).find(".snippet-content, .snippet-description, p").first().text().trim();
      const href = a.attr("href");
      const abs = absolute(href, baseUrl);
      if (!abs || !title) return;
      // filter out brave internal
      if (abs.includes("search.brave.com")) return;
      results.push({ title, url: abs, snippet, fetched_at: 0 });
    });
  }
  // fallback generic: any h2/a with snippet-like text
  if (results.length === 0) {
    $("a[href^='http']").each((_, el) => {
      const href = $(el).attr("href");
      const abs = absolute(href, baseUrl);
      if (!abs || abs.includes("brave.com")) return;
      const title = $(el).text().trim();
      if (title.length < 8 || title.length > 200) return;
      const snippet = $(el).parent().find("p").first().text().trim().slice(0, 300);
      if (results.length < 10) results.push({ title, url: abs, snippet, fetched_at: 0 });
    });
  }
  return results.slice(0, 10);
}

/** Parses Mojeek results. */
function parseMojeek(html: string, baseUrl: string): SearchResult[] {
  const $ = load(html);
  const results: SearchResult[] = [];
  $("ul.results-standard li, .ob, li.obs").each((_, el) => {
    const a = $(el).find("a.obTitle, a.title, h2 a, a").first();
    const title = a.text().trim();
    const snippet = $(el).find("p.s, p.description, .s").first().text().trim();
    const href = a.attr("href");
    const abs = absolute(href, baseUrl);
    if (!abs || !title) return;
    if (abs.includes("mojeek.com")) return;
    results.push({ title, url: abs, snippet, fetched_at: 0 });
  });
  // fallback
  if (results.length === 0) {
    $("a[href^='http']").each((_, el) => {
      const href = $(el).attr("href");
      const abs = absolute(href, baseUrl);
      if (!abs || abs.includes("mojeek.com")) return;
      const title = $(el).text().trim();
      if (title.length < 8 || title.length > 200) return;
      const snippet = $(el).parent().text().trim().slice(0, 200);
      if (results.length < 10) results.push({ title, url: abs, snippet, fetched_at: 0 });
    });
  }
  return results.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Verticals (intent-specific, keyless)
// ---------------------------------------------------------------------------

async function fetchWikipediaResults(query: string): Promise<SearchResult[]> {
  try {
    await assertSafeUrl("https://en.wikipedia.org/");
    const res = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: { action: "opensearch", search: query, limit: 5, namespace: 0, format: "json" },
      timeout: 5000,
    });
    const data = res.data as [string, string[], string[], string[]];
    const titles: string[] = data[1] ?? [];
    const snippets: string[] = data[2] ?? [];
    const urls: string[] = data[3] ?? [];
    const out: SearchResult[] = [];
    for (let i = 0; i < titles.length; i++) {
      if (urls[i]) out.push({ title: titles[i] || urls[i], url: urls[i], snippet: snippets[i] ?? "", fetched_at: 0 });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchGithubResults(query: string): Promise<SearchResult[]> {
  try {
    await assertSafeUrl("https://github.com/");
    // Use HTML search (no API key) — parse repository links
    const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
    await assertSafeUrl(url);
    const res = await axios.get(url, {
      timeout: 6000,
      headers: { "User-Agent": "blowsh-mcp/2.3.0", Accept: "text/html" },
      maxRedirects: 3,
    });
    const $ = load(String(res.data));
    const out: SearchResult[] = [];
    $("a[href*='/'][data-hydro-click]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || !/^\/[^/]+\/[^/]+$/.test(href)) return;
      const abs = `https://github.com${href}`;
      const title = $(el).text().trim() || href.slice(1);
      if (out.length < 5) out.push({ title, url: abs, snippet: "GitHub repository", fetched_at: 0 });
    });
    // fallback generic links to github repos
    if (out.length === 0) {
      $("a[href^='https://github.com/']").each((_, el) => {
        const href = $(el).attr("href") ?? "";
        if (out.length >= 3) return;
        if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(href)) {
          const title = $(el).text().trim() || href;
          if (title) out.push({ title: title.slice(0, 80), url: href, snippet: "", fetched_at: 0 });
        }
      });
    }
    return out.slice(0, 5);
  } catch {
    return [];
  }
}

async function fetchArxivResults(query: string): Promise<SearchResult[]> {
  try {
    await assertSafeUrl("http://export.arxiv.org/");
    const res = await axios.get("http://export.arxiv.org/api/query", {
      params: { search_query: `all:${query}`, start: 0, max_results: 5 },
      timeout: 6000,
      responseType: "text",
    });
    const xml = String(res.data);
    const $ = load(xml, { xmlMode: true });
    const out: SearchResult[] = [];
    $("entry").each((_, el) => {
      const title = $(el).find("title").first().text().trim().replace(/\s+/g, " ");
      const url = $(el).find("id").first().text().trim();
      const summary = $(el).find("summary").first().text().trim().replace(/\s+/g, " ").slice(0, 300);
      if (title && url) out.push({ title, url, snippet: summary, fetched_at: 0 });
    });
    return out;
  } catch {
    return [];
  }
}

async function fetchHnResults(query: string): Promise<SearchResult[]> {
  try {
    await assertSafeUrl("https://hn.algolia.com/");
    const res = await axios.get("https://hn.algolia.com/api/v1/search", {
      params: { query, hitsPerPage: 5, tags: "story" },
      timeout: 5000,
    });
    const data = res.data as { hits?: Array<{ title?: string; url?: string; objectID: string; points?: number }> };
    const out: SearchResult[] = [];
    for (const hit of data.hits ?? []) {
      const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const title = hit.title ?? url;
      out.push({ title, url, snippet: `HN ${hit.points ?? 0} points`, fetched_at: 0 });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export type SearchIntent = "auto" | "web" | "code" | "paper" | "news" | "entity";

function detectIntent(query: string, forced?: string): SearchIntent {
  if (forced && forced !== "auto") return forced as SearchIntent;
  const q = query.toLowerCase();
  if (q.includes("arxiv") || q.includes("paper") || q.includes("research") || q.includes("citation")) return "paper";
  if (q.includes("github") || q.includes("npm") || q.includes("pypi") || q.includes("code") || q.includes("function") || q.includes("error") || q.includes("stack overflow")) return "code";
  if (q.includes("news") || q.includes("breaking") || q.includes("today") || q.includes("latest")) return "news";
  if (/^(who is|what is|where is|definition of)/i.test(q.trim())) return "entity";
  return "web";
}

// ---------------------------------------------------------------------------
// DuckDuckGo Instant Answer
// ---------------------------------------------------------------------------

/**
 * Fetches the DuckDuckGo Instant Answer ("zero-click") abstract for a query.
 *
 * Fast path: DDG's public JSON API (api.duckduckgo.com) returns a polished
 * abstract for many factual queries with a single cheap request — no browser
 * render needed. The result is a synthetic search result with an empty URL.
 *
 * Graceful degradation: ANY failure returns `null` — the caller simply falls
 * back to organic results. This path is best-effort and must never throw.
 */
async function fetchInstantAnswer(query: string): Promise<string | null> {
  try {
    await assertSafeUrl("https://api.duckduckgo.com/");
    const res = await axios.get<{ AbstractText?: string }>(
      "https://api.duckduckgo.com/",
      {
        params: { q: query, format: "json", no_html: 1, skip_disambig: 1 },
        timeout: 5000,
      }
    );
    const abstract = res.data?.AbstractText?.trim();
    return abstract ? abstract : null;
  } catch {
    return null;
  }
}

/**
 * Renders one search engine page and parses its organic results. Bounded by
 * the shared browser mutex; cancellable via `signal` so the sibling engine
 * fetch can be aborted once the first engine returns results. An aborted
 * sibling resolves to `[]` (not an error); real failures rethrow.
 */
async function renderEngine(
  engine: { url: string; parse: (html: string) => SearchResult[] },
  signal?: AbortSignal
): Promise<SearchResult[]> {
  await assertSafeUrl(engine.url);
  try {
    await browshManager.ensureStarted();
    const dom = await browshManager.fetchDom(engine.url, signal);
    return engine.parse(dom);
  } catch (e) {
    // An aborted sibling is not an error — the other engine already won.
    if (axios.isCancel(e) || (axios.isAxiosError(e) && e.code === "ERR_CANCELED")) {
      return [];
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Merging — consensus + dedup
// ---------------------------------------------------------------------------

function mergeResults(sets: SearchResult[][]): SearchResult[] {
  const byUrl = new Map<string, { result: SearchResult; count: number; firstIdx: number }>();
  let idx = 0;
  for (const set of sets) {
    for (const r of set) {
      const key = r.url.replace(/\/$/, "");
      const existing = byUrl.get(key);
      if (existing) {
        existing.count++;
        // keep richest snippet
        if (r.snippet.length > existing.result.snippet.length) existing.result.snippet = r.snippet;
      } else {
        byUrl.set(key, { result: { ...r }, count: 1, firstIdx: idx++ });
      }
    }
  }
  const merged = Array.from(byUrl.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.firstIdx - b.firstIdx;
  }).map((v) => v.result);
  return merged;
}

// ---------------------------------------------------------------------------
// Single-query search (engines + verticals + merge)
// ---------------------------------------------------------------------------

async function searchSingleQuery(
  query: string,
  maxResults: number,
  page: number,
  enrich: boolean,
  intent: SearchIntent,
  deadlineMs?: number
): Promise<SearchResult[]> {
  const cacheKey = cacheKeyForQuery(query, intent);
  const cached = queryCache.get(cacheKey);
  const ttl = intentCacheTtl(intent, query);
  if (cached && Date.now() - cached.at < ttl) {
    return cached.results.slice(0, maxResults);
  }

  const engines: Array<{ url: string; parse: (html: string) => SearchResult[] }> = [
    { url: ddgSearchUrl(query, page), parse: (html) => parseDuckDuckGo(html, "https://duckduckgo.com/") },
    { url: bingSearchUrl(query, page), parse: (html) => parseBing(html, "https://www.bing.com/") },
    { url: braveSearchUrl(query, page), parse: (html) => parseBrave(html, "https://search.brave.com/") },
    { url: mojeekSearchUrl(query, page), parse: (html) => parseMojeek(html, "https://www.mojeek.com/") },
  ];

  // Verticals per intent (direct axios, no Browsh — friendly APIs)
  const verticalPromises: Promise<SearchResult[]>[] = [];
  if (intent === "code") verticalPromises.push(fetchGithubResults(query));
  else if (intent === "paper") verticalPromises.push(fetchArxivResults(query));
  else if (intent === "news") verticalPromises.push(fetchHnResults(query));
  else if (intent === "entity") verticalPromises.push(fetchWikipediaResults(query));
  // auto may still add entity if query looks factual — but keep simple: only forced intent triggers verticals for now

  const controller = new AbortController();
  const deadlineTimer = deadlineMs ? setTimeout(() => controller.abort(), deadlineMs) : null;

  try {
    const [instantAnswer, engineOutcomes, verticalResults] = await Promise.all([
      fetchInstantAnswer(query),
      Promise.allSettled(
        engines.map(async (engine) => {
          const results = await renderEngine(engine, controller.signal);
          return results;
        })
      ),
      Promise.all(verticalPromises).then((arr) => arr.flat()).catch(() => [] as SearchResult[]),
    ]);

    const engineResults: SearchResult[][] = [];
    let anyFulfilled = false;
    for (const o of engineOutcomes) {
      if (o.status === "fulfilled") {
        anyFulfilled = true;
        if (o.value.length > 0) engineResults.push(o.value);
      }
    }
    if (verticalResults.length > 0) engineResults.push(verticalResults);

    if (engineResults.length === 0 && !anyFulfilled) {
      const reason = engineOutcomes.map((o) => o.status === "rejected" ? o.reason : null).find((r) => r !== null);
      if (reason instanceof Error) throw reason;
      throw new FetchError(`No results found for query: ${query}`);
    }

    let merged = mergeResults(engineResults);

    // Enrichment: replace the top-3 organic snippets with fetched main-content
    // markdown. Best-effort, sequential, and hard-bounded by a wall-clock budget
    if (enrich && merged.length > 0) {
      const deadline = Date.now() + ENRICH_BUDGET_MS;
      for (const result of merged.slice(0, 3)) {
        if (Date.now() > deadline) break;
        if (controller.signal.aborted) break;
        try {
          const markdown = await fetchWeb({ url: result.url, type: "markdown", max_chars: 1500 });
          result.snippet = markdown.trim();
        } catch (e) {
          console.error(`[searchWeb] Enrichment failed for ${result.url}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const now = Date.now();
    const results: SearchResult[] = [];
    if (instantAnswer) {
      results.push({ title: "Instant Answer", url: "", snippet: instantAnswer, fetched_at: now });
    }
    for (const r of merged) results.push({ ...r, fetched_at: now });

    const sliced = results.slice(0, maxResults);
    // cache only organic merged (without instant answer timestamp drift)
    queryCache.set(cacheKey, { at: Date.now(), results: sliced });
    // cap cache size
    if (queryCache.size > 100) {
      const firstKey = queryCache.keys().next().value;
      if (firstKey) queryCache.delete(firstKey);
    }
    return sliced;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

// ---------------------------------------------------------------------------
// Public entry — now with query_variants, intent, deadline_ms
// ---------------------------------------------------------------------------

/**
 * Searches the web through rendered search engines and returns ranked results.
 * Engines (DDG, Bing, Brave, Mojeek) are rendered concurrently; results are
 * merged by consensus (cross-engine agreement) + dedup, rather than winner-takes-all.
 * Intent verticals (github, wikipedia, arxiv, hn) are added when intent dictates.
 * Query variants run in parallel and are merged.
 */
export async function searchWeb(
  query: string,
  maxResults = 10,
  page = 1,
  enrich = false,
  queryVariants?: string[],
  intent?: string,
  deadlineMs?: number
): Promise<SearchResult[]> {
  if (!query.trim()) throw new FetchError("Query must be a non-empty string");
  const max = Math.max(1, Math.min(30, maxResults));
  const currentPage = Math.max(1, Math.min(10, page));
  const resolvedIntent = detectIntent(query, intent);

  // Deadline wrapper for the whole operation (honest deadline error, never hang)
  const run = async (): Promise<SearchResult[]> => {
    // Handle query variants: base + up to 2 variants in parallel, merged
    const variants = (queryVariants ?? []).slice(0, 2).map((v) => v.trim()).filter(Boolean);
    const queries = [query, ...variants];

    if (queries.length === 1) {
      return searchSingleQuery(query, max, currentPage, enrich, resolvedIntent, deadlineMs);
    }

    // Variants: search each query in parallel, then merge per-query result sets with dedup across variants
    // For separated sets, we merge but preserve variant provenance in snippet? We merge flat for backward compat.
    const perQueryResults = await Promise.all(
      queries.map((q) => searchSingleQuery(q, max, currentPage, false, resolvedIntent, deadlineMs).catch(() => [] as SearchResult[]))
    );

    // Merge across variants: dedup by URL, keep highest consensus
    const flatMerged = mergeResults(perQueryResults);

    // Enrich after merge if requested (once)
    if (enrich && flatMerged.length > 0) {
      const deadline = Date.now() + ENRICH_BUDGET_MS;
      for (const result of flatMerged.slice(0, 3)) {
        if (Date.now() > deadline) break;
        try {
          const markdown = await fetchWeb({ url: result.url, type: "markdown", max_chars: 1500 });
          result.snippet = markdown.trim();
        } catch { /* ignore */ }
      }
    }

    const now = Date.now();
    for (const r of flatMerged) r.fetched_at = now;
    return flatMerged.slice(0, max);
  };

  if (deadlineMs && deadlineMs > 0) {
    const timeoutMs = Math.max(500, Math.min(600_000, deadlineMs));
    const deadlineError = new FetchError(`deadline.hit: search timed out after ${timeoutMs}ms (query: ${query})`, {});
    // Attach stable code for branching
    (deadlineError as unknown as { code?: string }).code = "deadline.hit";
    return Promise.race([
      run(),
      new Promise<SearchResult[]>((_, reject) => setTimeout(() => reject(deadlineError), timeoutMs)),
    ]);
  }

  return run();
}
