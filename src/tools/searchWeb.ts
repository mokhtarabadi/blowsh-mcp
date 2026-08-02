import { load } from "cheerio";
import { browshManager } from "../browshManager.js";
import { assertSafeUrl } from "../ssrf.js";
import { FetchError } from "../errors.js";

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
 * Searches the web via a rendered search engine and returns ranked results
 * (title, url, snippet). First tries DuckDuckGo HTML, falls back to Bing.
 */
export async function searchWeb(query: string, maxResults = 10): Promise<SearchResult[]> {
  if (!query.trim()) throw new FetchError("Query must be a non-empty string");
  const max = Math.max(1, Math.min(30, maxResults));

  const engines: Array<{ url: string; parse: (html: string) => SearchResult[] }> = [
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      parse: (html) => parseDuckDuckGo(html, "https://duckduckgo.com/"),
    },
    {
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${max}`,
      parse: (html) => parseBing(html, "https://www.bing.com/"),
    },
  ];

  let lastError: unknown = null;
  for (const engine of engines) {
    await assertSafeUrl(engine.url);
    try {
      await browshManager.ensureStarted();
      const dom = await browshManager.fetchDom(engine.url);
      const results = engine.parse(dom);
      if (results.length > 0) return results.slice(0, max);
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new FetchError(`No results found for query: ${query}`);
}