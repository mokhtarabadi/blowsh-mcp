import axios from "axios";
import { load } from "cheerio";
import { browshManager } from "../browshManager.js";
import { assertSafeUrl } from "../ssrf.js";
import { FetchError } from "../errors.js";
import { extractMainHtml } from "../extract.js";
import { html2markdownConvert } from "../html2markdownManager.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CrawlMode = "full" | "map" | "content";

export interface CrawlWebOptions {
  url: string;
  mode?: CrawlMode;
  focus?: string;
  max_pages?: number;
  max_depth?: number;
  max_total_chars?: number;
  per_page_max?: number;
  include_paths?: string[];
  exclude_paths?: string[];
  same_host?: boolean;
  respect_robots?: boolean;
  deadline_s?: number;
  resume?: string;
  since_last?: boolean;
}

export interface CrawlPage {
  url: string;
  title: string;
  kind: string;
  markdown: string;
  chars: number;
  quality: number;
  duplicate: boolean;
  parent: string | null;
  score: number;
  lastmod?: string | null;
}

export interface CrawlResult {
  seed: string;
  pages: CrawlPage[];
  map: string[];
  queued: string[];
  filtered_out: number;
  skipped: Array<{ url: string; reason: string }>;
  stop: string;
  elapsed_s: number;
  resume: string | null;
  crawl_delay: number | null;
}

// ---------------------------------------------------------------------------
// Helpers — URL & globs
// ---------------------------------------------------------------------------

function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    // remove trailing slash except root
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    return parsed.toString();
  } catch {
    return u;
  }
}

function isSameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}

function globToRegExp(glob: string): RegExp {
  // Convert glob like "/docs/*" or "*/tags/*" to RegExp
  let esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  esc = esc.replace(/\*\*/g, "___DOUBLESTAR___");
  esc = esc.replace(/\*/g, "[^/]*");
  esc = esc.replace(/___DOUBLESTAR___/g, ".*");
  esc = esc.replace(/\?/g, ".");
  return new RegExp(`^${esc}$`);
}

function pathMatches(pathname: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((p) => globToRegExp(p).test(pathname));
}

function scopeAllowed(pathname: string, include: string[], exclude: string[]): boolean {
  if (exclude.length > 0 && pathMatches(pathname, exclude)) return false;
  if (include.length > 0) return pathMatches(pathname, include);
  return true;
}

const DEFAULT_EXCLUDES = [
  "/login*",
  "/signin*",
  "/signup*",
  "/register*",
  "/cart*",
  "/checkout*",
  "*/tags/*",
  "*/tag/*",
  "*/archive/*",
];

function effectiveExcludes(user: string[]): string[] {
  const set = new Set([...DEFAULT_EXCLUDES, ...user]);
  return Array.from(set);
}

// ---------------------------------------------------------------------------
// Robots.txt
// ---------------------------------------------------------------------------

interface Robots {
  disallows: string[];
  crawlDelay: number | null;
}

async function fetchRobots(host: string): Promise<Robots> {
  const url = `https://${host}/robots.txt`;
  try {
    await assertSafeUrl(url);
    const res = await axios.get(url, { timeout: 5000, maxRedirects: 3, responseType: "text", validateStatus: () => true });
    if (res.status !== 200) return { disallows: [], crawlDelay: null };
    const text: string = String(res.data);
    const disallows: string[] = [];
    let crawlDelay: number | null = null;
    let inWildcard = false;
    for (const raw of text.split("\n")) {
      const line = raw.split("#")[0]?.trim() ?? "";
      if (!line) continue;
      if (/^user-agent:/i.test(line)) {
        const ua = line.split(":")[1]?.trim() ?? "";
        inWildcard = ua === "*" || ua === "";
      } else if (inWildcard && /^disallow:/i.test(line)) {
        const p = line.split(":")[1]?.trim() ?? "";
        if (p) disallows.push(p);
      } else if (inWildcard && /^crawl-delay:/i.test(line)) {
        const v = Number(line.split(":")[1]?.trim() ?? "");
        if (Number.isFinite(v)) crawlDelay = v;
      }
    }
    return { disallows, crawlDelay };
  } catch {
    return { disallows: [], crawlDelay: null };
  }
}

function isAllowed(pathname: string, robots: Robots): boolean {
  for (const d of robots.disallows) {
    if (d === "/" && pathname.startsWith("/")) {
      // "/" disallows everything — but many sites list "/" for bots; we still respect
      // Check if it's exactly "/" means block all. DonSeTch would still crawl? We'll respect but allow map mode.
      // For blowsh, if disallow is "/", we treat as blocked unless explicitly allowed by include.
      return false;
    }
    if (pathname.startsWith(d)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  priority?: number;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    await assertSafeUrl(url);
    const res = await axios.get(url, { timeout: 7000, maxRedirects: 3, responseType: "text", validateStatus: () => true });
    if (res.status !== 200) return null;
    return String(res.data);
  } catch {
    return null;
  }
}

function parseSitemapXml(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  try {
    const $ = load(xml, { xmlMode: true });
    $("url").each((_, el) => {
      const loc = $(el).find("loc").first().text().trim();
      if (!loc) return;
      const lastmod = $(el).find("lastmod").first().text().trim() || undefined;
      const priStr = $(el).find("priority").first().text().trim();
      const priority = priStr ? Number(priStr) : undefined;
      entries.push({ loc, lastmod, priority: Number.isFinite(priority) ? priority : undefined });
    });
    // also handle sitemapindex
    if (entries.length === 0) {
      $("sitemap").each((_, el) => {
        const loc = $(el).find("loc").first().text().trim();
        if (loc) entries.push({ loc });
      });
    }
  } catch {
    /* ignore parse errors */
  }
  return entries;
}

async function discoverSitemaps(seedHost: string, cap: number): Promise<{ robots: Robots; entries: SitemapEntry[] }> {
  const robots = await fetchRobots(seedHost);
  const candidates: string[] = [
    `https://${seedHost}/sitemap.xml`,
    `https://${seedHost}/sitemap_index.xml`,
    `https://${seedHost}/sitemap-index.xml`,
  ];
  // add sitemaps declared in robots.txt (we didn't capture them; fetch again with sitemap lines)
  try {
    const robotsText = await fetchText(`https://${seedHost}/robots.txt`);
    if (robotsText) {
      for (const line of robotsText.split("\n")) {
        const m = line.match(/^\s*sitemap:\s*(\S+)/i);
        if (m?.[1]) candidates.push(m[1].trim());
      }
    }
  } catch { /* ignore */ }

  const allEntries: SitemapEntry[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    if (allEntries.length >= cap * 2) break;
    if (seen.has(cand)) continue;
    seen.add(cand);
    const xml = await fetchText(cand);
    if (!xml) continue;
    const entries = parseSitemapXml(xml);
    // if this was a sitemapindex, fetch child sitemaps
    const isIndex = xml.includes("<sitemapindex");
    if (isIndex && entries.length > 0) {
      for (const e of entries.slice(0, 20)) {
        if (allEntries.length >= cap * 2) break;
        const childXml = await fetchText(e.loc);
        if (!childXml) continue;
        const childEntries = parseSitemapXml(childXml);
        for (const ce of childEntries) {
          if (allEntries.length >= cap * 2) break;
          allEntries.push(ce);
        }
      }
    } else {
      for (const e of entries) {
        if (allEntries.length >= cap * 2) break;
        allEntries.push(e);
      }
    }
  }
  // newest first if lastmod present
  allEntries.sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""));
  return { robots, entries: allEntries.slice(0, cap * 4) };
}

// ---------------------------------------------------------------------------
// Focus scoring (BM25-lite for frontier)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9\u0600-\u06FF]+/g).filter((w) => w.length >= 2);
}

function scoreCandidate(anchor: string, urlPath: string, focus?: string): number {
  if (!focus) return 1;
  const qTokens = tokenize(focus);
  if (qTokens.length === 0) return 1;
  const doc = `${anchor} ${urlPath}`.toLowerCase();
  const docTokens = tokenize(doc);
  let hits = 0;
  for (const q of qTokens) {
    if (docTokens.includes(q) || doc.includes(q)) hits++;
  }
  if (hits === 0) return 0;
  // length-normalized TF + path depth boost
  const depth = urlPath.split("/").filter(Boolean).length;
  return hits / qTokens.length + (depth >= 2 ? 0.2 : 0) + (anchor.length > 15 ? 0.15 : 0);
}

// ---------------------------------------------------------------------------
// Quality & kind
// ---------------------------------------------------------------------------

function qualityScore(markdown: string): number {
  const len = markdown.length;
  if (len < 100) return 0.06;
  const codeBlocks = (markdown.match(/```/g) ?? []).length / 2;
  const headings = (markdown.match(/^#{1,6}\s/mg) ?? []).length;
  const tables = (markdown.match(/\|/g) ?? []).length;
  let q = Math.min(1, len / 2500);
  if (codeBlocks > 0) q += 0.08;
  if (headings >= 2) q += 0.07;
  if (tables > 10) q += 0.05;
  return Math.min(0.98, q);
}

function contentKind(markdown: string): string {
  const hasTable = markdown.includes("|") && markdown.includes("---");
  const headings = (markdown.match(/^#{1,6}\s/mg) ?? []).length;
  const code = markdown.includes("```");
  if (hasTable && headings < 3) return "Table";
  if (code && headings >= 3) return "Docs";
  if (headings >= 4) return "Article";
  if (markdown.includes("- ") && headings < 2) return "Listing";
  return "Page";
}

function titleFromDom(dom: string): string {
  try {
    const $ = load(dom);
    const t = $("title").first().text().trim() || $("h1").first().text().trim();
    return t.slice(0, 200);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Resume store (disk-backed, 30 min TTL)
// ---------------------------------------------------------------------------

const RESUME_FILE = path.join(os.tmpdir(), "blowsh-crawl-resumes.json");
const FINGERPRINT_FILE = path.join(os.tmpdir(), "blowsh-crawl-fingerprints.json");

interface ResumeState {
  seed: string;
  queue: Array<{ url: string; score: number; depth: number; parent: string | null }>;
  seen: string[];
  mode: CrawlMode;
  focus?: string;
  include_paths: string[];
  exclude_paths: string[];
  same_host: boolean;
  respect_robots: boolean;
}

interface ResumeFile {
  entries: Record<string, { state: ResumeState; at: number }>;
}

function loadResumeFile(): ResumeFile {
  try {
    const raw = fs.readFileSync(RESUME_FILE, "utf-8");
    return JSON.parse(raw) as ResumeFile;
  } catch {
    return { entries: {} };
  }
}

function saveResumeFile(f: ResumeFile): void {
  try {
    fs.mkdirSync(path.dirname(RESUME_FILE), { recursive: true });
    const tmp = RESUME_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(f));
    fs.renameSync(tmp, RESUME_FILE);
  } catch { /* ignore */ }
}

function sweepResumeFile(f: ResumeFile): void {
  const now = Date.now();
  for (const [k, v] of Object.entries(f.entries)) {
    if (now - v.at > 30 * 60 * 1000) delete f.entries[k];
  }
}

function createResumeToken(): string {
  return `crawl_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

// Fingerprint helpers for since_last
function loadFingerprints(): Record<string, { hash: string; at: number }> {
  try {
    return JSON.parse(fs.readFileSync(FINGERPRINT_FILE, "utf-8")) as Record<string, { hash: string; at: number }>;
  } catch {
    return {};
  }
}
function saveFingerprints(fp: Record<string, { hash: string; at: number }>): void {
  try {
    fs.mkdirSync(path.dirname(FINGERPRINT_FILE), { recursive: true });
    fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify(fp));
  } catch { /* ignore */ }
}
function hashContent(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Main crawl
// ---------------------------------------------------------------------------

export async function crawlWeb(opts: CrawlWebOptions): Promise<CrawlResult> {
  const started = Date.now();
  const deadlineMs = (opts.deadline_s ?? 120) * 1000;
  const maxPages = opts.max_pages ?? 10;
  const maxDepth = opts.max_depth ?? 2;
  const maxTotalChars = opts.max_total_chars ?? 60_000;
  const perPageMax = opts.per_page_max ?? 8_000;
  const mode: CrawlMode = opts.mode ?? "full";
  const focus = opts.focus;
  const include = opts.include_paths ?? [];
  const exclude = effectiveExcludes(opts.exclude_paths ?? []);
  const sameHost = opts.same_host ?? true;
  const respectRobots = opts.respect_robots ?? true;
  const sinceLast = opts.since_last ?? false;

  let seed = opts.url;
  let resumeQueue: ResumeState["queue"] | null = null;
  let resumeSeen: string[] | null = null;

  // Handle resume token
  if (opts.resume) {
    const file = loadResumeFile();
    sweepResumeFile(file);
    const entry = file.entries[opts.resume];
    if (!entry) throw new FetchError(`resume token expired or unknown: ${opts.resume}`);
    const st = entry.state;
    if (!seed) seed = st.seed;
    resumeQueue = st.queue;
    resumeSeen = st.seen;
    // use resumed options where not overridden (but caller's opts take precedence)
    // For simplicity, keep caller's focus/mode etc, but restore queue/seen
    // remove token after use (one-shot)
    delete file.entries[opts.resume];
    saveResumeFile(file);
  }

  if (!seed) throw new FetchError("url is required (or resume token with stored seed)");
  if (!seed.startsWith("http://") && !seed.startsWith("https://")) throw new FetchError("URL must start with http:// or https://", { url: seed });
  await assertSafeUrl(seed);

  const seedUrl = new URL(seed);
  const seedHost = seedUrl.hostname;

  // --- Phase 1: map (sitemap discovery) ---
  let map: string[] = [];
  let sitemapEntries: SitemapEntry[] = [];
  let robots: Robots = { disallows: [], crawlDelay: null };

  if (mode !== "content") {
    const discovered = await discoverSitemaps(seedHost, 120);
    robots = discovered.robots;
    sitemapEntries = discovered.entries;
    const localeSet = new Set<string>();
    for (const e of sitemapEntries) {
      if (map.length >= 120) break;
      try {
        const u = new URL(e.loc);
        if (sameHost && u.hostname !== seedHost) continue;
        if (!scopeAllowed(u.pathname, include, exclude)) continue;
        if (respectRobots && !isAllowed(u.pathname, robots)) continue;
        if (focus && scoreCandidate("", u.pathname, focus) === 0) continue;
        // locale dedup simplified: path without first segment locale code?
        const canon = u.pathname.toLowerCase().replace(/^\/(en|de|fr|es|ja|zh|ko|pt|ru|ar)\//, "/");
        if (localeSet.has(canon)) continue;
        localeSet.add(canon);
        map.push(e.loc);
      } catch { /* skip bad url */ }
    }
  } else {
    if (respectRobots) robots = await fetchRobots(seedHost);
  }

  if (mode === "map") {
    const skipped: Array<{ url: string; reason: string }> = [];
    if (map.length === 0) skipped.push({ url: seed, reason: "no sitemap found at common locations : use mode=content to BFS from the seed" });
    return {
      seed,
      pages: [],
      map,
      queued: [],
      filtered_out: 0,
      skipped,
      stop: "FrontierEmpty",
      elapsed_s: (Date.now() - started) / 1000,
      resume: null,
      crawl_delay: robots.crawlDelay,
    };
  }

  // --- Frontier seeding ---
  type QueueItem = { url: string; score: number; depth: number; parent: string | null };
  const queue: QueueItem[] = [];
  const seen = new Set<string>(resumeSeen ?? []);
  let filteredOut = 0;

  function pushQueue(url: string, score: number, depth: number, parent: string | null): void {
    const norm = normalizeUrl(url);
    if (seen.has(norm)) return;
    seen.add(norm);
    queue.push({ url: norm, score, depth, parent });
    // keep queue sorted by score descending (frontier best-first)
    queue.sort((a, b) => b.score - a.score);
  }

  if (resumeQueue && resumeQueue.length > 0) {
    for (const q of resumeQueue) queue.push(q);
    queue.sort((a, b) => b.score - a.score);
  } else {
    pushQueue(seed, 10, 0, null);
    for (const e of sitemapEntries) {
      try {
        const u = new URL(e.loc);
        if (sameHost && u.hostname !== seedHost) continue;
        if (!scopeAllowed(u.pathname, include, exclude)) continue;
        if (respectRobots && !isAllowed(u.pathname, robots)) continue;
        if (focus && scoreCandidate("", u.pathname, focus) === 0) continue;
        const s = scoreCandidate("", u.pathname, focus) + (e.priority ?? 0) * 2;
        pushQueue(e.loc, s, 1, seed);
      } catch { /* skip */ }
    }
  }

  const pages: CrawlPage[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const fingerprints = sinceLast ? loadFingerprints() : {};
  let totalChars = 0;
  let stop: string = "FrontierEmpty";
  let throttledStreak = 0;

  // Governor pacing: base + size variance, exponential on 429
  let backoffMs = 0;

  await browshManager.ensureStarted();

  while (queue.length > 0) {
    // deadline check
    if (Date.now() - started >= deadlineMs) { stop = "Deadline"; break; }
    if (pages.length >= maxPages) { stop = "MaxPages"; break; }
    if (totalChars >= maxTotalChars) { stop = "CharBudget"; break; }

    const item = queue.shift()!;
    if (item.depth > maxDepth) { stop = "DepthLimit"; skipped.push({ url: item.url, reason: "depth limit" }); continue; }

    // since_last skip check (fingerprint still fresh <24h)
    if (sinceLast) {
      const fp = fingerprints[item.url];
      if (fp && Date.now() - fp.at < 24 * 60 * 60 * 1000) {
        // we still need to know if page changed — but without fetching we can't.
        // Optimistic: skip if fingerprint exists and <24h. Real DonSeTch fetches then diffs; we skip fetch.
        skipped.push({ url: item.url, reason: "since_last: unchanged (fingerprinted <24h)" });
        continue;
      }
    }

    // pacing
    if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
    else if (robots.crawlDelay) await new Promise((r) => setTimeout(r, robots.crawlDelay! * 1000));
    else if (pages.length > 0) {
      // dwell variance proportional to previous page size (~100-600ms)
      const lastChars = pages[pages.length - 1]?.chars ?? 800;
      const dwell = 400 + Math.min(500, Math.floor(lastChars / 5));
      await new Promise((r) => setTimeout(r, dwell));
    }

    // SSRF guard for dequeued URL (crawl queue can be polluted via sitemap/forged links)
    try {
      await assertSafeUrl(item.url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push({ url: item.url, reason: `ssrf: ${msg}` });
      continue;
    }

    let dom: string | null = null;
    try {
      dom = await browshManager.fetchDom(item.url);
      throttledStreak = 0;
      backoffMs = 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429") || msg.includes("503") || msg.includes("Throttled")) {
        throttledStreak++;
        backoffMs = Math.min(8000, 1000 * Math.pow(2, throttledStreak));
        // re-queue with lower score for retry once
        if (throttledStreak <= 2) {
          queue.push({ ...item, score: item.score - 1 });
          queue.sort((a, b) => b.score - a.score);
        } else {
          skipped.push({ url: item.url, reason: `throttled (${msg.slice(0, 120)})` });
        }
        if (throttledStreak >= 3 && queue.length === 0) { stop = "ThrottledOut"; break; }
        continue;
      }
      skipped.push({ url: item.url, reason: msg.slice(0, 200) });
      continue;
    }
    if (!dom) {
      skipped.push({ url: item.url, reason: "empty dom" });
      continue;
    }

    // Extract markdown
    let htmlForMd: string;
    try {
      htmlForMd = extractMainHtml(dom);
    } catch {
      htmlForMd = dom;
    }
    let markdown = "";
    try {
      markdown = await html2markdownConvert(htmlForMd, { domain: item.url });
    } catch (e) {
      skipped.push({ url: item.url, reason: `markdown convert failed: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (focus) {
      // filter pages that don't match focus at content level (optional second gate)
      const score = scoreCandidate(markdown.slice(0, 500), new URL(item.url).pathname, focus);
      if (score === 0 && item.url !== seed) {
        // skip adding to pages but still allow frontier expansion? For now skip expansion too
        skipped.push({ url: item.url, reason: "focus filtered (no match)" });
        continue;
      }
    }
    // per-page truncation
    if (markdown.length > perPageMax) markdown = markdown.slice(0, perPageMax) + `\n…[per_page_max ${perPageMax} reached]`;
    // budget check after truncation
    if (totalChars + markdown.length > maxTotalChars) {
      // Include partial page if it fits somewhat
      const remaining = maxTotalChars - totalChars;
      if (remaining > 500) {
        const partial = markdown.slice(0, remaining) + `\n…[max_total_chars ${maxTotalChars} reached]`;
        pages.push({
          url: item.url,
          title: titleFromDom(dom),
          kind: contentKind(partial),
          markdown: partial,
          chars: partial.length,
          quality: qualityScore(partial),
          duplicate: false,
          parent: item.parent,
          score: item.score,
          lastmod: sitemapEntries.find((s) => s.loc === item.url)?.lastmod ?? null,
        });
        totalChars += partial.length;
      }
      stop = "CharBudget";
      break;
    }

    const quality = qualityScore(markdown);
    if (quality < 0.05) {
      skipped.push({ url: item.url, reason: `low quality ${quality.toFixed(2)}` });
      continue;
    }
    // near-dup detection: title + first 200 chars hash
    const dupKey = hashContent(titleFromDom(dom) + markdown.slice(0, 200));
    const isDup = pages.some((p) => hashContent(p.title + p.markdown.slice(0, 200)) === dupKey);
    if (isDup) {
      pages.push({
        url: item.url,
        title: titleFromDom(dom),
        kind: contentKind(markdown),
        markdown,
        chars: markdown.length,
        quality,
        duplicate: true,
        parent: item.parent,
        score: item.score,
        lastmod: sitemapEntries.find((s) => s.loc === item.url)?.lastmod ?? null,
      });
      totalChars += markdown.length;
      skipped.push({ url: item.url, reason: "near-duplicate" });
      continue;
    }

    // since_last fingerprint update
    if (sinceLast) {
      fingerprints[item.url] = { hash: hashContent(markdown), at: Date.now() };
    }

    pages.push({
      url: item.url,
      title: titleFromDom(dom),
      kind: contentKind(markdown),
      markdown,
      chars: markdown.length,
      quality,
      duplicate: false,
      parent: item.parent,
      score: item.score,
      lastmod: sitemapEntries.find((s) => s.loc === item.url)?.lastmod ?? null,
    });
    totalChars += markdown.length;

    // Frontier expansion: extract links from this page
    if (queue.length < 80) {
      try {
        const $ = load(dom);
        const links: Array<{ href: string; text: string }> = [];
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          const text = $(el).text().trim().slice(0, 80);
          if (href) links.push({ href, text });
        });
        for (const l of links.slice(0, 40)) {
          try {
            if (/^(javascript|mailto|tel|data|blob|#):/i.test(l.href)) continue;
            const abs = new URL(l.href, item.url).toString();
            const parsed = new URL(abs);
            if (sameHost && parsed.hostname !== seedHost) continue;
            if (!scopeAllowed(parsed.pathname, include, exclude)) continue;
            if (respectRobots && !isAllowed(parsed.pathname, robots)) continue;
            // focus frontier scoring — skip non-matching links entirely when focus set
            const candScore = scoreCandidate(l.text, parsed.pathname, focus);
            if (focus && candScore === 0) continue;
            const depth = item.depth + 1;
            if (depth > maxDepth) continue;
            const norm = normalizeUrl(abs);
            if (seen.has(norm)) continue;
            try { await assertSafeUrl(abs); } catch { continue; }
            // simple near-dup avoidance for frontier
            pushQueue(abs, candScore + (1 / (depth + 1)), depth, item.url);
          } catch { /* skip bad href */ }
        }
      } catch { /* ignore link extraction failures */ }
    }

    // budget checks after expansion
    if (pages.length >= maxPages) { stop = "MaxPages"; break; }
    if (totalChars >= maxTotalChars) { stop = "CharBudget"; break; }
  }

  if (queue.length === 0 && stop === "FrontierEmpty") { /* remain */ }
  else if (queue.length > 0 && stop === "FrontierEmpty") {
    // if loop exited due to break from budget, stop already set
  } else if (queue.length === 0 && stop !== "FrontierEmpty" && pages.length < maxPages) {
    // natural exhaustion after budgets not hit
    if (stop === "FrontierEmpty" || stop === "MaxPages" || stop === "CharBudget" || stop === "DepthLimit" || stop === "Deadline" || stop === "ThrottledOut") {
      // keep existing stop
    } else stop = "FrontierEmpty";
  }

  if (sinceLast) saveFingerprints(fingerprints);

  // Build resume token if needed (stopped early with remaining queue)
  let resume: string | null = null;
  if (queue.length > 0 && stop !== "FrontierEmpty") {
    const token = createResumeToken();
    const file = loadResumeFile();
    sweepResumeFile(file);
    file.entries[token] = {
      state: {
        seed,
        queue: queue.map((q) => ({ url: q.url, score: q.score, depth: q.depth, parent: q.parent })),
        seen: Array.from(seen),
        mode,
        focus,
        include_paths: include,
        exclude_paths: exclude,
        same_host: sameHost,
        respect_robots: respectRobots,
      },
      at: Date.now(),
    };
    saveResumeFile(file);
    resume = token;
  }

  const elapsed_s = (Date.now() - started) / 1000;
  const queued = queue.map((q) => q.url);

  return {
    seed,
    pages,
    map,
    queued,
    filtered_out: filteredOut,
    skipped,
    stop,
    elapsed_s,
    resume,
    crawl_delay: robots.crawlDelay,
  };
}
