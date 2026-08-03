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
}

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
    results.push({ title: link.text().trim() || abs, url: abs, snippet });
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
    results.push({ title: a.text().trim() || abs, url: abs, snippet });
  });
  return results;
}

/**
 * Fetches the DuckDuckGo Instant Answer ("zero-click") abstract for a query.
 *
 * Fast path: DDG's public JSON API (api.duckduckgo.com) returns a polished
 * abstract for many factual queries (definitions, capital cities, etc.) with a
 * single cheap request — no browser render needed. The result is a synthetic
 * search result with an empty URL, prepended by `searchWeb` when available.
 *
 * Graceful degradation: ANY failure (network, timeout, no abstract, malformed
 * response) returns `null` — the caller simply falls back to organic results.
 * This path is best-effort by design and must never throw.
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
 * Searches the web through a rendered search engine and returns ranked results
 * (title, url, snippet). DuckDuckGo HTML is tried first, with a Bing fallback.
 *
 * @param query The search query.
 * @param maxResults Max organic results to return (1-30).
 * @param page Result page (1-10). Each engine's offset is synthesized from the
 *   page number (DDG: 20/page, Bing: 10/page).
 * @param enrich When true, the top 3 organic results' snippets are replaced
 *   with fetched main-content markdown (≤1500 chars each) — best-effort.
 *
 * Instant Answer behavior: if DDG's zero-click API returns an abstract for the
 * query, a synthetic result `{ title: "Instant Answer", url: "", snippet }` is
 * prepended; it counts toward `max_results`. An empty organic result set is a
 * terminal success and returns `[]` — only engine/network failures throw.
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

  const engines: Array<{ url: string; parse: (html: string) => SearchResult[] }> = [
    {
      url: ddgSearchUrl(query, currentPage),
      parse: (html) => parseDuckDuckGo(html, "https://duckduckgo.com/"),
    },
    {
      url: bingSearchUrl(query, currentPage),
      parse: (html) => parseBing(html, "https://www.bing.com/"),
    },
  ];

  const instantAnswer = await fetchInstantAnswer(query);

  let organic: SearchResult[] = [];
  let lastError: unknown = null;
  let anyEngineCompleted = false;
  for (const engine of engines) {
    await assertSafeUrl(engine.url);
    try {
      await browshManager.ensureStarted();
      const dom = await browshManager.fetchDom(engine.url);
      organic = engine.parse(dom);
      anyEngineCompleted = true;
      if (organic.length > 0) break;
    } catch (e) {
      lastError = e;
    }
  }

  // Only propagate an engine error if NO engine succeeded at all.
  // If any engine returned zero results cleanly, that's terminal success [].
  if (organic.length === 0 && !anyEngineCompleted && lastError !== null) {
    if (lastError instanceof Error) throw lastError;
    throw new FetchError(`No results found for query: ${query}`);
  }

  // Enrichment: replace the top-3 organic snippets with fetched main-content
  // markdown. Best-effort — a rejected fetch keeps the original snippet.
  if (enrich && organic.length > 0) {
    const top = organic.slice(0, 3);
    const settled = await Promise.allSettled(
      top.map((r) =>
        fetchWeb({ url: r.url, type: "markdown", max_chars: 1500 })
      )
    );
    settled.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        top[i]!.snippet = outcome.value.trim();
      } else {
        console.error(
          `[searchWeb] Enrichment failed for ${top[i]?.url}: ${
            outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
          }`
        );
      }
    });
  }

  const results: SearchResult[] = [];
  if (instantAnswer) results.push({ title: "Instant Answer", url: "", snippet: instantAnswer });
  results.push(...organic);
  return results.slice(0, max);
}