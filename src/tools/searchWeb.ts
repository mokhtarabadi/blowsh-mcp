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

function decodeDdgRedirect(href?: string): string | undefined {
  if (!href || !href.includes("duckduckgo.com/l/")) return href;
  try {
    const u = new URL(href.startsWith("//") ? `https:${href}` : href);
    const target = u.searchParams.get("uddg");
    return target && /^https?:\/\//i.test(target) ? target : href;
  } catch {
    return href;
  }
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

/** Parses DuckDuckGo HTML (html.duckduckgo.com) results. */
function parseDuckDuckGo(html: string, baseUrl: string): SearchResult[] {
  const $ = load(html);
  const results: SearchResult[] = [];
  $(".result").each((_, el) => {
    const link = $(el).find(".result__a").first();
    const snippet = $(el).find(".result__snippet").first().text().trim();
    const href = decodeDdgRedirect(link.attr("href"));
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
    const abs = absolute(a.attr("href"), baseUrl);
    if (!abs) return;
    results.push({ title: a.text().trim() || abs, url: abs, snippet, fetched_at: 0 });
  });
  return results;
}

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

/**
 * Searches the web through rendered search engines and returns ranked results.
 * DuckDuckGo HTML and Bing are rendered CONCURRENTLY (single shared browser,
 * mutex-serialized); the first engine to return results aborts the other, so
 * worst-case latency is bounded by the slowest single engine, not their sum.
 * DDG's Instant Answer API is probed in parallel and its abstract is prepended
 * as a synthetic result when available.
 *
 * @param query The search query.
 * @param maxResults Max results to return (1-30), including the synthetic IA.
 * @param page Result page (1-10). Engine offsets are synthesized per engine.
 * @param enrich When true, the top 3 organic results' snippets are replaced
 *   with fetched main-content markdown (≤1500 chars each) — best-effort,
 *   bounded by a 45 s wall-clock budget.
 *
 * Every result carries `fetched_at` (UTC epoch ms) so consumers can gauge
 * staleness. An empty organic result set is terminal success → `[]`; errors
 * are only propagated when NO engine completed at all.
 */
export async function searchWeb(
  query: string,
  maxResults = 10,
  page = 1,
  enrich = false
): Promise<SearchResult[]> {
  if (!query.trim()) throw new FetchError("Query must be a non-empty string");
  const max = Math.max(1, Math.min(30, maxResults));
  const currentPage = Math.max(1, Math.min(10, page));

  const engines = [
    {
      url: ddgSearchUrl(query, currentPage),
      parse: (html: string) => parseDuckDuckGo(html, "https://duckduckgo.com/"),
    },
    {
      url: bingSearchUrl(query, currentPage),
      parse: (html: string) => parseBing(html, "https://www.bing.com/"),
    },
  ];

  // Fire the instant-answer probe and both engine renders in parallel.
  const controller = new AbortController();
  let winner: SearchResult[] | null = null;

  const [instantAnswer, engineOutcomes] = await Promise.all([
    fetchInstantAnswer(query),
    Promise.allSettled(
      engines.map(async (engine) => {
        const results = await renderEngine(engine, controller.signal);
        if (winner === null && results.length > 0) {
          winner = results;
          controller.abort(); // the other engine's render is no longer needed
        }
        return results;
      })
    ),
  ]);

  const completedEngines = engineOutcomes.filter((o) => o.status === "fulfilled").length;
  // Explicit annotation: TS cannot track closure assignments to `winner`, so
  // an uninferred `?? []` would narrow to never[] and break downstream access.
  const organic: SearchResult[] = winner ?? [];

  if (organic.length === 0 && completedEngines === 0) {
    // No engine even completed — surface the underlying failure instead of a
    // misleading empty result set. (If any engine completed cleanly with zero
    // results, that's terminal success `[]`.)
    const reason = engineOutcomes
      .map((o) => (o.status === "rejected" ? o.reason : null))
      .find((r) => r !== null);
    if (reason instanceof Error) throw reason;
    throw new FetchError(`No results found for query: ${query}`);
  }

  // Enrichment: replace the top-3 organic snippets with fetched main-content
  // markdown. Best-effort, sequential, and hard-bounded by a wall-clock budget
  // so enrichment can never push a search past the client's request timeout.
  if (enrich && organic.length > 0) {
    const deadline = Date.now() + ENRICH_BUDGET_MS;
    for (const result of organic.slice(0, 3)) {
      if (Date.now() > deadline) break;
      try {
        const markdown = await fetchWeb({ url: result.url, type: "markdown", max_chars: 1500 });
        result.snippet = markdown.trim();
      } catch (e) {
        console.error(
          `[searchWeb] Enrichment failed for ${result.url}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
  }

  const now = Date.now();
  const results: SearchResult[] = [];
  if (instantAnswer) {
    results.push({ title: "Instant Answer", url: "", snippet: instantAnswer, fetched_at: now });
  }
  for (const r of organic) results.push({ ...r, fetched_at: now });
  return results.slice(0, max);
}
