import { load } from "cheerio";
import { browshManager } from "../browshManager.js";
import { assertSafeUrl } from "../ssrf.js";
import { pageCache, cacheKey } from "../cache.js";
import { FetchError } from "../errors.js";

export interface Link {
  text: string;
  url: string;
}

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  if (/^(javascript|mailto|tel|data|blob|about|#):/i.test(href)) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Extracts all hyperlinks (anchor hrefs) from the JS-rendered page.
 * Relative URLs are resolved against the page URL; non-web protocols skipped.
 */
export async function extractLinks(url: string, limit = 50): Promise<Link[]> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new FetchError("URL must start with http:// or https://", { url });
  }
  await assertSafeUrl(url);

  const key = cacheKey(url, "links");
  const cached = pageCache.get(key);
  if (cached) {
    return JSON.parse(cached) as Link[];
  }

  await browshManager.ensureStarted();
  const dom = await browshManager.fetchDom(url);
  const $ = load(dom);

  const links: Link[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const abs = absolute($(el).attr("href"), url);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    links.push({ text: $(el).text().trim().slice(0, 200), url: abs });
  });

  const result = links.slice(0, Math.max(1, Math.min(200, limit)));
  pageCache.set(key, JSON.stringify(result));
  return result;
}