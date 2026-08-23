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

/** URL path segments that strongly indicate navigation chrome. */
const NOISE_URL_PATTERNS = [
  /^\/(login|signin|signup|register|auth|oauth|sso)\b/i,
  /^\/(settings|preferences|account|profile|notifications)\b/i,
  /^\/(status|changelog|releases|security|privacy|terms|cookies|sitemap)\b/i,
  /^\/(contact|support|help|feedback|about|careers|jobs|pricing|plans)\b/i,
  /^\/(features|enterprise|partners|customers|showcase)\b/i,
  /^\/(explore|collections|events|topics|trending|starred)\b/i,
  /^\/(new|create|import|fork|compare)\b/i,
  /^\/(search|q)\b/i,
];

/** Anchor text that strongly indicates navigation chrome. */
const NOISE_TEXT_PATTERNS = [
  /^(sign\s?in|log\s?in|login|signup|register|create account)/i,
  /^(skip to|jump to|go to)/i,
  /^(terms|privacy|cookie|legal|license|copyright|©)/i,
  /^(contact|support|help|feedback|status|changelog)/i,
  /^(menu|close|open|toggle|search|next|previous|back)/i,
];

/**
 * Heuristic score for a link. Higher = more likely to be a content link.
 * Returns 0–100. Links scoring below NOISE_THRESHOLD are dropped.
 */
function linkScore(text: string, url: string, base: string): number {
  let score = 50; // baseline

  // --- URL signals ---
  try {
    const parsed = new URL(url);
    const baseParsed = new URL(base);
    const path = parsed.pathname;

    // Same-host links get a boost (external links are often ads/social)
    if (parsed.hostname === baseParsed.hostname) score += 10;

    // Path depth: deeper paths are more likely content
    const depth = path.split("/").filter(Boolean).length;
    if (depth >= 2) score += 10;
    if (depth >= 3) score += 5;

    // Noise URL patterns: heavy penalty
    for (const pat of NOISE_URL_PATTERNS) {
      if (pat.test(path)) { score -= 40; break; }
    }

    // Hash-only links (#section) are usually in-page navigation
    if (parsed.hash && parsed.pathname === new URL(base).pathname) score -= 15;

  } catch { /* invalid URL, low score */ }

  // --- Text signals ---
  const cleanText = text.replace(/\s+/g, " ").trim();

  // Empty or very short text is suspicious
  if (cleanText.length === 0) score -= 20;
  if (cleanText.length > 0 && cleanText.length < 3) score -= 10;

  // Descriptive text (10–100 chars) is a strong content signal
  if (cleanText.length >= 10 && cleanText.length <= 100) score += 10;

  // Noise text patterns: heavy penalty
  for (const pat of NOISE_TEXT_PATTERNS) {
    if (pat.test(cleanText)) { score -= 30; break; }
  }

  // --- Position signals (heuristic via ancestor check in caller) ---
  // Score is further adjusted by the caller based on DOM position.

  return Math.max(0, Math.min(100, score));
}

/** Links scoring below this threshold are dropped entirely. */
const NOISE_THRESHOLD = 30;

/**
 * Extracts hyperlinks from the JS-rendered page, ranked by relevance.
 *
 * Strategy:
 * 1. Strip semantic noise elements (nav, header, footer, aside).
 * 2. Score every remaining link via URL + text heuristics.
 * 3. Sort by score descending, then return top `limit` results.
 * 4. Drop links scoring below NOISE_THRESHOLD.
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

  // Step 1: Strip semantic noise elements.
  const NOISE_SELECTORS = [
    "nav", "header", "footer", "aside",
    "script", "style", "noscript", "template",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
  ];
  for (const sel of NOISE_SELECTORS) {
    try { $(sel).remove(); } catch { /* skip invalid selectors */ }
  }

  // Step 2: Collect and score all links.
  const scored: Array<{ text: string; url: string; score: number }> = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const abs = absolute(href, url);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);

    const text = $(el).text().trim().slice(0, 200);
    let score = linkScore(text, abs, url);

    // Position bonus: links inside <main>, <article>, or content-like containers
    const isContent = $(el).closest("main, article, [role='main'], [id='content'], .content, .post, .entry, .article").length > 0;
    if (isContent) score += 20;

    // Position penalty: links deep inside footer-like structures (even non-semantic)
    const inFooter = $(el).closest("footer, [class*='footer'], [class*='Footer'], [class*='sidebar'], [class*='Sidebar']").length > 0;
    if (inFooter) score -= 25;

    scored.push({ text, url: abs, score });
  });

  // Step 3: Sort by score descending, filter noise, take top N.
  const result = scored
    .filter((l) => l.score >= NOISE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map(({ text, url }) => ({ text, url }));

  pageCache.set(key, JSON.stringify(result));
  return result;
}
