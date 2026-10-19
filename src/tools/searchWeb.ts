import { load } from "cheerio";
import axios from "axios";
import { browshManager } from "../browshManager.js";
import { assertSafeUrl } from "../ssrf.js";
import { FetchError, createDeadlineError, isDeadlineHitError } from "../errors.js";
import { fetchWeb } from "./fetchWeb.js";

/**
 * Pure precedence rule for an empty merged result under a deadline.
 * Exported for tests. Returns true only when the global deadline fired
 * (signal aborted) AND nothing usable was collected — this is a
 * deadline.hit, never an ordinary empty result.
 */
export function isEmptyResultDeadline(
  aborted: boolean,
  mergedCount: number,
  hasInstantAnswer: boolean,
  deadlineMs?: number
): boolean {
  return !!deadlineMs && aborted && mergedCount === 0 && !hasInstantAnswer;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** UTC epoch milliseconds when this result set was fetched (staleness signal). */
  fetched_at: number;
}

/** Total wall-clock budget for the enrichment phase (ms). Overridable via ENRICH_BUDGET_MS. */
const ENRICH_BUDGET_MS = Number(process.env.ENRICH_BUDGET_MS ?? 45_000);

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

  // Google: https://www.google.com/url?q=<encoded-url>&... or root-relative /url?q=<encoded-url>...
  if (href.includes("google.com/url") || href.startsWith("/url?")) {
    try {
      const u = new URL(href, "https://www.google.com");
      const target = u.searchParams.get("q") || u.searchParams.get("url");
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

/**
 * Deny-list for non-organic URLs (learned from google-sr modular parsers and
 * serp-parser organic-only rule). Rendered Browsh DOM mixes nav, ads, footer,
 * consent and related-search anchors with results — accept an anchor only when
 * its URL survives this filter.
 */
function isDeniedResultUrl(abs: string): boolean {
  let u: URL;
  try {
    u = new URL(abs);
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  // Share-intent and ad hosts (full-URL signals, host-aware).
  if (host.includes("facebook.com") && abs.toLowerCase().includes("/sharer")) return true;
  if (host.includes("twitter.com") && abs.toLowerCase().includes("/intent")) return true;
  if (host.includes("linkedin.com") && abs.toLowerCase().includes("/share")) return true;
  if (host.startsWith("ads.") || path.includes("/ads/") || path.includes("/aclk")) return true;
  // Engine-internal search/consent/account paths only — docs on the same
  // domain (e.g. brave.com/download, support.google.com) must survive.
  if (host.includes("search.brave.com")) return true;
  if (host.includes("mojeek.com") && (path.startsWith("/search") || path.includes("/preferences"))) return true;
  if (
    host.includes("google.") &&
    (path.startsWith("/search") ||
      path.startsWith("/preferences") ||
      path.startsWith("/advanced_search") ||
      path.startsWith("/sorry") ||
      path.startsWith("/accounts") ||
      path === "/")
  )
    return true;
  if (host.includes("startpage.com") && path.startsWith("/sp/search")) return true;
  // Generic account/consent/login paths on any host — segment-aware so
  // content paths like /login-guide survive while /login still drops.
  const firstSeg = path.split("?")[0].split("#")[0].split("/").filter(Boolean)[0] ?? "";
  if (
    firstSeg === "login" ||
    firstSeg === "signup" ||
    firstSeg === "account" ||
    firstSeg === "consent" ||
    firstSeg === "settings" ||
    firstSeg === "preferences"
  )
    return true;
  return false;
}

/**
 * Lightweight query-relevance guard. Requires token overlap between the query
 * and title + snippet + URL text. Prevents nav/ad/footer garbage from passing
 * through merge when selectors drift. Synthetic Instant Answer (empty URL) is
 * always exempt. CJK queries yielding zero tokens stay exempt (locked by test).
 */
export function passesRelevanceGuard(
  title: string,
  snippet: string,
  url: string,
  query: string
): boolean {
  if (!url) return true;
  const toks = query
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i)
    .filter((w) => w.length > 2);
  if (toks.length === 0) return true;
  const hay = `${title} ${snippet} ${url}`.toLowerCase();
  const hits = toks.filter((t) => hay.includes(t)).length;
  if (toks.length <= 3) return hits >= 1;
  return hits / toks.length >= 0.3;
}

/** Google search URL (10 results per page, start param). Attempted first; often robot-blocked. */
function googleSearchUrl(query: string, page: number): string {
  const start = (page - 1) * 10;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&start=${start}`;
}

/** Startpage search URL (Google-quality proxy, 10 results per page). */
function startpageSearchUrl(query: string, page: number): string {
  return `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}&page=${page}`;
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
      // filter out brave internal + nav/ads/footer (deny-list)
      if (isDeniedResultUrl(abs)) return;
      // require snippet sibling so nav-only anchors never pass (serp-parser rule)
      if (!snippet) return;
      results.push({ title, url: abs, snippet, fetched_at: 0 });
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
    if (isDeniedResultUrl(abs)) return;
    if (!snippet) return;
    results.push({ title, url: abs, snippet, fetched_at: 0 });
  });
  return results.slice(0, 10);
}

/**
 * Detects bot-guard block pages (Google unusual-traffic, Startpage verify,
 * Marginalia bot-activity). Checks page title, headings, and structural
 * CAPTCHA elements, avoiding false positives on organic search snippets.
 */
export function isBlockedPage(html: string): boolean {
  const $ = load(html);
  // Structural challenge signals first: captcha forms and challenge widgets
  // mean block even when stale organic containers linger in the DOM.
  const forms = $('form[action*="Captcha"], form#captcha-form, form[action*="sorry"]');
  if (forms.length > 0) return true;

  const recaptcha = $('[data-sitekey], .g-recaptcha, .cf-turnstile, #captcha-form');
  if (recaptcha.length > 0) return true;

  const hasOrganicResults = $("div.g, div.tF2Cxc, .result, .w-gl__result, li.b_algo, .b_algo").length > 0;

  const title = $("title").text().toLowerCase().trim();
  const h1 = $("h1").text().toLowerCase().trim();

  // Strong title/h1 signals win even over stale organic containers — except
  // genuine SERP titles ("Search: <query>") which legitimately echo block
  // words from the query; those rely on structural signals above.
  const genuineSerpTitle = title.startsWith("search") || title.includes("search results");
  if (!genuineSerpTitle) {
    if (
      title.includes("unusual traffic") ||
      title.includes("verifying your request") ||
      title.includes("aggressive bot activity") ||
      title.includes("robot check") ||
      title.includes("captcha") ||
      title.includes("consent") ||
      title.includes("sorry...") ||
      title.includes("attention required") ||
      h1.includes("unusual traffic") ||
      h1.includes("verifying your request") ||
      h1.includes("aggressive bot activity") ||
      h1.includes("robot check")
    ) {
      return true;
    }
  }

  // Organic results present: genuine results page — snippet text may mention
  // block phrases (false-positive guard for weak text checks; strong title
  // already won above).
  if (hasOrganicResults) return false;

  // Weak whole-HTML substring checks last: snippet/body text may legitimately
  // mention block phrases, so these only decide pages with no organics.
  const l = html.toLowerCase();
  if (
    l.includes("/sorry/index") ||
    l.includes("our systems have detected unusual traffic") ||
    l.includes("please solve this challenge to continue")
  ) {
    return true;
  }

  return false;
}

/** Parses Google organic results (best-effort across layouts). */
export function parseGoogle(html: string, baseUrl: string): SearchResult[] {
  if (isBlockedPage(html)) return [];
  const $ = load(html);
  const results: SearchResult[] = [];
  $("div.g, div.tF2Cxc").each((_, el) => {
    const a = $(el).find("a").first();
    const title = $(el).find("h3").first().text().trim() || a.text().trim();
    const snippet = $(el).find("div.VwiC3b, div.IsZvec, span.st").first().text().trim();
    const href = decodeRedirect(a.attr("href"));
    const abs = absolute(href, baseUrl);
    if (!abs || !title) return;
    if (isDeniedResultUrl(abs)) return;
    results.push({ title, url: abs, snippet, fetched_at: 0 });
  });
  if (results.length === 0) {
    // Narrow rescue: /url?q= links are Google-organic-specific (not generic
    // a[href] sweep), still deny-listed and length-bounded.
    const NAV_TITLES = new Set(["advanced search", "preferences", "settings", "sign in"]);
    $("a[href*='/url?q=']").each((_, el) => {
      const href = decodeRedirect($(el).attr("href"));
      const abs = absolute(href, baseUrl);
      if (!abs || isDeniedResultUrl(abs)) return;
      const title = $(el).text().trim();
      if (NAV_TITLES.has(title.toLowerCase())) return;
      if (title.length < 8 || title.length > 200) return;
      if (results.length < 10) results.push({ title, url: abs, snippet: "", fetched_at: 0 });
    });
  }
  return results.slice(0, 10);
}

/** Parses Startpage results (Google-quality proxy, best-effort). */
export function parseStartpage(html: string, baseUrl: string): SearchResult[] {
  if (isBlockedPage(html)) return [];
  const $ = load(html);
  const results: SearchResult[] = [];
  $(".result, .w-gl__result, div.result-item").each((_, el) => {
    const a = $(el).find("a.result-title, a.w-gl__result-title, a").first();
    const title = a.text().trim();
    const snippet = $(el).find("p.result-snippet, p.w-gl__description, p").first().text().trim();
    const abs = absolute(a.attr("href"), baseUrl);
    if (!abs || !title) return;
    if (abs.includes("startpage.com")) return;
    results.push({ title, url: abs, snippet, fetched_at: 0 });
  });
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
      headers: { "User-Agent": "blowsh-mcp/2.3.2", Accept: "text/html" },
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

/** Withdrawn/retracted entries must never outrank real papers (word-boundary: keeps "Retractable"). */
const WITHDRAWN_RE = /\bwithdrawn\b|\bretract(?:ed|ion)?s?\b/i;

function scoreArxivResult(title: string, summary: string, query: string): number {
  const t = title.toLowerCase();
  const s = summary.toLowerCase();
  const phrase = query.toLowerCase().replace(/\s+/g, " ").trim();
  const toks = phrase.split(" ").filter((w) => w.length > 1);
  let score = 0;
  if (phrase.length > 2 && t.includes(phrase)) score += 5;
  score += toks.filter((w) => t.includes(w)).length * 2;
  if (phrase.length > 2 && s.includes(phrase)) score += 1;
  score += toks.filter((w) => s.includes(w)).length * 0.2;
  return score;
}

async function fetchArxivResults(query: string): Promise<SearchResult[]> {
  try {
    await assertSafeUrl("http://export.arxiv.org/");
    const res = await axios.get("http://export.arxiv.org/api/query", {
      params: { search_query: `all:${query}`, start: 0, max_results: 10 },
      timeout: 6000,
      responseType: "text",
    });
    const xml = String(res.data);
    const $ = load(xml, { xmlMode: true });
    const scored: Array<{ result: SearchResult; score: number }> = [];
    $("entry").each((_, el) => {
      const title = $(el).find("title").first().text().trim().replace(/\s+/g, " ");
      const url = $(el).find("id").first().text().trim();
      const summary = $(el).find("summary").first().text().trim().replace(/\s+/g, " ").slice(0, 300);
      if (!title || !url) return;
      if (WITHDRAWN_RE.test(`${title} ${summary}`)) return; // drop withdrawn/retracted
      scored.push({
        result: { title, url, snippet: summary, fetched_at: 0 },
        score: scoreArxivResult(title, summary, query),
      });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((s) => s.result);
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

/**
 * Simplifies an over-constrained query for fallback retries: strips quotes,
 * site: filters, boolean operators and +/- prefixes. Used ONLY when the
 * vertical already returned empty — the original query always runs first.
 */
function simplifyQuery(q: string): string {
  return q
    .replace(/"/g, "")
    .replace(/\bsite:\S+/gi, "")
    .replace(/\b(AND|OR|NOT)\b/gi, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[+-]/, ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

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
    if (isBlockedPage(dom)) return [];
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
// Cheap browser-free fallback (used ONLY after a deadline.hit with zero data)
// ---------------------------------------------------------------------------

const CHEAP_UA = { "User-Agent": "blowsh-mcp/2.3.2", Accept: "text/html" };

/**
 * Fetches DDG-html + Mojeek pages over plain HTTP (no Browsh) and parses
 * them with the standard organic parsers. Best-effort: any failure yields [].
 */
async function fetchCheapFallback(query: string, max: number): Promise<SearchResult[]> {
  const jobs: Promise<SearchResult[]>[] = [
    axios
      .get(ddgSearchUrl(query, 1), { timeout: 8000, headers: CHEAP_UA, maxRedirects: 3 })
      .then((r) => parseDuckDuckGo(String(r.data), "https://duckduckgo.com/"))
      .catch(() => [] as SearchResult[]),
    axios
      .get(mojeekSearchUrl(query, 1), { timeout: 8000, headers: CHEAP_UA, maxRedirects: 3 })
      .then((r) => parseMojeek(String(r.data), "https://www.mojeek.com/"))
      .catch(() => [] as SearchResult[]),
  ];
  const sets = await Promise.all(jobs);
  const now = Date.now();
  const merged = mergeResults(sets.filter((s) => s.length > 0));
  return merged.slice(0, max).map((r) => ({ ...r, fetched_at: now }));
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
  deadlineMs?: number,
  retried = false
): Promise<SearchResult[]> {
  const cacheKey = cacheKeyForQuery(query, intent);
  const cached = queryCache.get(cacheKey);
  const ttl = intentCacheTtl(intent, query);
  if (cached && Date.now() - cached.at < ttl) {
    return cached.results.slice(0, maxResults);
  }

  // Tiered engines are defined inline below (Tier 1: Google, Tier 2:
  // Startpage, Tier 3: 4-engine consensus pool) — no concurrent 6-engine fan-out.

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
    // 1. Kick off direct-HTTP calls in parallel (no Browsh mutex contention)
    const [instantAnswer, verticalResults] = await Promise.all([
      fetchInstantAnswer(query),
      Promise.all(verticalPromises).then((arr) => arr.flat()).catch(() => [] as SearchResult[]),
    ]);

    const engineResults: SearchResult[][] = [];

    // 2. Tier 1: Google (Primary attempt)
    // If Google succeeds and returns clean results, short-circuit immediately.
    const googleEngine = {
      url: googleSearchUrl(query, page),
      parse: (html: string) => parseGoogle(html, "https://www.google.com/"),
    };

    try {
      const googleRes = await renderEngine(googleEngine, controller.signal);
      if (googleRes.length > 0) {
        engineResults.push(googleRes);
      }
    } catch (e) {
      if (!axios.isCancel(e) && !(axios.isAxiosError(e) && e.code === "ERR_CANCELED")) {
        console.error(`[searchWeb] Google attempt failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. Tier 2: Startpage (Google-quality proxy fallback)
    // If Google was robot-blocked or yielded 0 results, try Startpage.
    if (engineResults.length === 0 && !controller.signal.aborted) {
      const startpageEngine = {
        url: startpageSearchUrl(query, page),
        parse: (html: string) => parseStartpage(html, "https://www.startpage.com/"),
      };
      try {
        const startpageRes = await renderEngine(startpageEngine, controller.signal);
        if (startpageRes.length > 0) {
          engineResults.push(startpageRes);
        }
      } catch (e) {
        if (!axios.isCancel(e) && !(axios.isAxiosError(e) && e.code === "ERR_CANCELED")) {
          console.error(`[searchWeb] Startpage attempt failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // 4. Tier 3: 4-Engine Consensus pool fallback (Brave, Mojeek, Bing, DDG)
    // Only triggered if both Google and Startpage failed or were blocked.
    if (engineResults.length === 0 && !controller.signal.aborted) {
      const fallbackEngines = [
        { url: braveSearchUrl(query, page), parse: (html: string) => parseBrave(html, "https://search.brave.com/") },
        { url: mojeekSearchUrl(query, page), parse: (html: string) => parseMojeek(html, "https://www.mojeek.com/") },
        { url: bingSearchUrl(query, page), parse: (html: string) => parseBing(html, "https://www.bing.com/") },
        { url: ddgSearchUrl(query, page), parse: (html: string) => parseDuckDuckGo(html, "https://duckduckgo.com/") },
      ];

      const poolOutcomes = await Promise.allSettled(
        fallbackEngines.map(async (engine) => renderEngine(engine, controller.signal))
      );

      for (const o of poolOutcomes) {
        if (o.status === "fulfilled" && o.value.length > 0) {
          engineResults.push(o.value);
        }
      }
    }

    if (verticalResults.length > 0) engineResults.push(verticalResults);

    if (engineResults.length === 0 && !instantAnswer) {
      if (isEmptyResultDeadline(controller.signal.aborted, 0, false, deadlineMs)) {
        throw createDeadlineError(`deadline.hit: search timed out after ${deadlineMs}ms (query: ${query})`);
      }
    }

    let merged = mergeResults(engineResults);

    // Relevance guard: drop zero-overlap items before output and cache so a
    // drifted selector cannot pass nav/ads garbage through consensus. An
    // over-strict guard yields honest empty, never garbage.
    if (merged.length > 0) {
      const guarded = merged.filter((r) =>
        passesRelevanceGuard(r.title, r.snippet, r.url, query)
      );
      merged = guarded;
    }

    // D3: the inner deadline abort converts slow engines into fulfilled [].
    // An empty merge under a fired global deadline is deadline.hit — throw
    // the typed error so the outer race runs the cheap fallback instead of
    // resolving a bare [] that is indistinguishable from genuine no-results.
    // Must precede the news/entity simplify-retry (retrying would exceed budget).
    if (isEmptyResultDeadline(controller.signal.aborted, merged.length, !!instantAnswer, deadlineMs)) {
      throw createDeadlineError(`deadline.hit: search timed out after ${deadlineMs}ms (query: ${query})`);
    }

    // Empty-only fallback: brittle vertical queries (long news/entity strings)
    // retry once simplified, then once as plain web. Non-empty first passes
    // are untouched, so the simple-query baseline cannot regress.
    if (merged.length === 0 && !instantAnswer && !retried && (intent === "news" || intent === "entity")) {
      const simple = simplifyQuery(query);
      if (simple && simple.toLowerCase() !== query.toLowerCase().replace(/\s+/g, " ").trim()) {
        return searchSingleQuery(simple, maxResults, page, enrich, "web", deadlineMs, true);
      }
    }

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
    // D3: a per-query deadline.hit must propagate (outer race runs the cheap
    // fallback); swallowing it into [] would re-introduce the bare-[] bug.
    const perQueryResults = await Promise.all(
      queries.map((q) =>
        searchSingleQuery(q, max, currentPage, false, resolvedIntent, deadlineMs).catch((e: unknown) => {
          if (isDeadlineHitError(e)) throw e;
          return [] as SearchResult[];
        })
      )
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
    const deadlineError = createDeadlineError(`deadline.hit: search timed out after ${timeoutMs}ms (query: ${query})`);
    return Promise.race([
      run(),
      new Promise<SearchResult[]>((_, reject) => setTimeout(() => reject(deadlineError), timeoutMs)),
    ]).catch(async (e) => {
      // Deadline with zero data is the worst failure mode: try a cheap
      // browser-free fallback (plain HTTP engine pages) and return whatever
      // it yields as partial results. Only throw when fallback is empty too.
      if (!isDeadlineHitError(e)) throw e;
      try {
        const partial = await fetchCheapFallback(query, max);
        if (partial.length > 0) {
          console.error(`[searchWeb] deadline.hit — returning ${partial.length} cheap-fallback partial results`);
          return partial;
        }
      } catch { /* fall through to original error */ }
      throw e;
    });
  }

  return run();
}
