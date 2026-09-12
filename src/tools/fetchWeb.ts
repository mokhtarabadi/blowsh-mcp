import { browshManager } from "../browshManager.js";
import { html2markdownConvert } from "../html2markdownManager.js";
import { extractPdf } from "./extractPdf.js";
import { assertSafeUrl } from "../ssrf.js";
import { pageCache, cacheKey } from "../cache.js";
import {
  extractMainHtml,
  selectText,
  selectHtml,
  truncate,
  focusFilter,
  extractToc,
  extractSectionHtml,
  probeMustContain,
  findNextUrl,
  stripLinks,
  stripMedia,
  applyOffset,
} from "../extract.js";
import { FetchError } from "../errors.js";
import axios from "axios";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface FetchWebOptions {
  url: string;
  type: "plain" | "html" | "markdown" | "pdf";
  selector?: string;
  max_chars?: number;
  wait_ms?: number;
  // DonSeTch parity additions (all optional, backwards compatible)
  focus?: string;
  toc?: boolean;
  section?: string;
  must_contain?: string;
  archive?: "auto" | "only" | "off";
  stitch?: boolean;
  // v2.3.1 additional parity
  deadline_ms?: number;
  tier?: "auto" | "1" | "2";
  links?: boolean;
  media?: boolean;
  since_last?: boolean;
  offset?: number;
}

const TYPES = ["plain", "html", "markdown", "pdf"] as const;
const SETTLE_INTERVAL_MS = 700;
const SNIFF_TIMEOUT_MS = 5_000;

/** Safety cap for non-HTML fast-path responses (10 MB). Prevents OOM on
 *  oversized JSON/text payloads. Responses exceeding this are truncated. */
const NON_HTML_MAX_BYTES = 10 * 1024 * 1024;

/**
 * HTML-like Content-Types that warrant full browser rendering.
 * Everything else (JSON, plain text, XML, etc.) is returned raw.
 */
const HTML_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
];

interface SniffResult {
  contentType: string;
  isHtml: boolean;
  status: number;
}

/**
 * Lightweight HEAD/GET probe to detect Content-Type before invoking Browsh.
 * Saves 30s of wasted rendering on JSON APIs, plain-text endpoints, and
 * non-HTML error pages. Returns null on network failure (caller falls
 * through to Browsh as before).
 */
async function sniffContentType(url: string): Promise<SniffResult | null> {
  try {
    // Try HEAD first (cheaper); fall back to GET if server rejects it.
    let res;
    try {
      res = await axios.head(url, { timeout: SNIFF_TIMEOUT_MS, maxRedirects: 5 });
    } catch {
      // GET fallback: no maxContentLength (some servers reject HEAD).
      // The short timeout bounds latency; response body is discarded by caller.
      res = await axios.get(url, {
        timeout: SNIFF_TIMEOUT_MS,
        maxRedirects: 5,
        responseType: "text",
        signal: AbortSignal.timeout(SNIFF_TIMEOUT_MS),
      });
    }
    const ct = (res.headers["content-type"] as string ?? "").toLowerCase().split(";")[0].trim();
    return {
      contentType: ct,
      isHtml: HTML_CONTENT_TYPES.some((t) => ct.includes(t)) || ct === "",
      status: res.status,
    };
  } catch {
    return null; // network/SSL/DNS failure — let Browsh handle the error
  }
}

function validateUrl(url: string): void {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new FetchError("URL must start with http:// or https://", { url });
  }
}

// ---------------------------------------------------------------------------
// Archive (Wayback Machine) helpers
// ---------------------------------------------------------------------------

interface WaybackSnapshot {
  html: string;
  timestamp: string;
  url: string;
}

async function fetchWaybackSnapshot(originalUrl: string): Promise<WaybackSnapshot | null> {
  try {
    // SSRF check for the Wayback API host (public, safe)
    await assertSafeUrl("https://web.archive.org/");
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`;
    const res = await axios.get(api, { timeout: 7000, maxRedirects: 3 });
    const closest = (res.data as { archived_snapshots?: { closest?: { available: boolean; url: string; timestamp: string; status: string } } })?.archived_snapshots?.closest;
    if (!closest?.available || !closest.url) return null;
    // Fetch the snapshot — use id_ to get raw (un-rewritten) if possible, but the API URL already works
    const snapshotUrl: string = closest.url;
    // Guard: snapshot URL must be web.archive.org
    if (!snapshotUrl.includes("web.archive.org")) return null;
    const snapRes = await axios.get(snapshotUrl, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: "text",
      maxContentLength: 5 * 1024 * 1024,
      headers: { "User-Agent": "blowsh-mcp/2.3.2" },
    });
    if (snapRes.status >= 400) return null;
    const html = String(snapRes.data);
    if (!html || html.length < 200) return null;
    return { html, timestamp: closest.timestamp, url: snapshotUrl };
  } catch {
    return null;
  }
}

function isHardFailure(e: unknown): boolean {
  if (e instanceof FetchError) {
    const msg = e.message.toLowerCase();
    // 4xx/5xx or explicit status code
    if (e.statusCode !== undefined && e.statusCode >= 400) return true;
    if (msg.includes("404") || msg.includes("403") || msg.includes("paywall") || msg.includes("blocked") || msg.includes("failed with status")) return true;
    // network-ish failures are also hard: let archive try
    if (msg.includes("could not resolve") || msg.includes("timeout") || msg.includes("request failed")) return true;
  }
  if (axios.isAxiosError(e) && e.response?.status !== undefined && e.response.status >= 400) return true;
  return false;
}

// ---------------------------------------------------------------------------
// since_last fingerprint store (fetch)
// ---------------------------------------------------------------------------

const FETCH_FP_FILE = path.join(os.tmpdir(), "blowsh-fetch-fingerprints.json");

function loadFetchFingerprints(): Record<string, { hash: string; at: number }> {
  try {
    return JSON.parse(fs.readFileSync(FETCH_FP_FILE, "utf-8")) as Record<string, { hash: string; at: number }>;
  } catch {
    return {};
  }
}
function saveFetchFingerprints(fp: Record<string, { hash: string; at: number }>): void {
  try {
    fs.mkdirSync(path.dirname(FETCH_FP_FILE), { recursive: true });
    fs.writeFileSync(FETCH_FP_FILE, JSON.stringify(fp));
  } catch { /* ignore */ }
}
function hashContent(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function handleSinceLast(url: string, content: string, enabled?: boolean): { content: string; changed: boolean } {
  if (!enabled) return { content, changed: true };
  const fps = loadFetchFingerprints();
  const curHash = hashContent(content);
  const prev = fps[url];
  if (prev && prev.hash === curHash) {
    const ageMs = Date.now() - prev.at;
    const ageH = (ageMs / 3600000).toFixed(1);
    return { content: `unchanged since last fetch (${url}, fingerprint ${curHash}, age ${ageH}h)`, changed: false };
  }
  fps[url] = { hash: curHash, at: Date.now() };
  // prune old entries >100
  const keys = Object.keys(fps);
  if (keys.length > 200) {
    const sorted = Object.entries(fps).sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < sorted.length - 150; i++) delete fps[sorted[i][0]];
  }
  saveFetchFingerprints(fps);
  if (prev) {
    const header = `> [changed since last fetch — previous fingerprint ${prev.hash}, now ${curHash}]\n\n`;
    return { content: header + content, changed: true };
  }
  saveFetchFingerprints(fps);
  return { content, changed: true };
}

// ---------------------------------------------------------------------------
// DOM → final content processing (toc/section/markdown conversion/focus/probe)
// ---------------------------------------------------------------------------

async function processDomForType(dom: string, url: string, opts: FetchWebOptions): Promise<string> {
  const { type, selector, focus, toc, section, must_contain, links, media } = opts;

  // Selector narrowing: if selector is set, narrow the DOM first
  let sourceHtml: string | null = dom;
  if (selector) {
    const html = selectHtml(dom, selector);
    if (html === null) throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
    sourceHtml = html;
  }

  // TOC mode — outline only, no body
  if (toc && !section) {
    // use selector-narrowed html if present, else full dom
    const htmlForToc = sourceHtml ?? dom;
    return extractToc(htmlForToc);
  }

  // Section mode — extract single section's markdown/html
  if (section) {
    const htmlForSection = sourceHtml ?? dom;
    const sectionHtml = extractSectionHtml(htmlForSection, section);
    if (sectionHtml === null) {
      throw new FetchError(`Section '${section}' not found (no heading matched)`, { url });
    }
    if (type === "html") return sectionHtml;
    if (type === "plain") {
      // strip tags crudely via cheerio text? reuse selectText logic but we have html
      // For plain section, extract text content
      const { load } = await import("cheerio");
      const $ = load(sectionHtml);
      return $.text().trim();
    }
    // markdown: convert sectionHtml via html2markdown
    let md = await html2markdownConvert(sectionHtml, { domain: url });
    // post-process: focus + probe still apply after section slicing
    if (focus) md = focusFilter(md, focus);
    // links/media handling
    if (links === false) md = stripLinks(md);
    if (media === false) md = stripMedia(md);
    if (must_contain) {
      const probe = probeMustContain(md, must_contain);
      const excerpts = probe.excerpts.length > 0 ? probe.excerpts.map((e, i) => `${i + 1}. ${e}`).join("\n") : "_(no context)_";
      return `${probe.verdict} for "${must_contain}" in section "${section}" (${url})\n\n${excerpts}`;
    }
    return md;
  }

  // Normal per-type handling (no toc/section)
  if (type === "html") {
    // HTML already handled selector above; if no selector return full dom
    if (selector) return sourceHtml as string;
    return dom;
  }

  if (type === "markdown") {
    let htmlForMd: string;
    if (selector) {
      htmlForMd = sourceHtml as string;
    } else {
      htmlForMd = extractMainHtml(sourceHtml ?? dom);
    }
    let md = await html2markdownConvert(htmlForMd, { domain: url });
    if (focus) md = focusFilter(md, focus);
    if (links === false) md = stripLinks(md);
    if (media === false) md = stripMedia(md);
    if (must_contain) {
      const probe = probeMustContain(md, must_contain);
      const excerpts = probe.excerpts.length > 0 ? probe.excerpts.map((e, i) => `${i + 1}. ${e}`).join("\n") : "_(no context)_";
      return `${probe.verdict} for "${must_contain}" (${url})\n\n${excerpts}\n\n[probe collapsed full content (${md.length} chars) to ~${probe.verdict.length + excerpts.length} chars]`;
    }
    return md;
  }

  // plain without selector is handled earlier as Browsh terminal text fast-path,
  // but that path is bypassed when toc/section/focus/must_contain are set.
  // For plain + selector or plain with focus/probe, we extract text via cheerio.
  if (type === "plain") {
    if (selector) {
      const text = selectText(dom, selector);
      if (text === null) throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
      let out = text;
      if (focus) {
        // for plain, reuse focusFilter on text (split by paragraphs)
        out = focusFilter(out, focus);
      }
      if (links === false) out = stripLinks(out);
      if (media === false) out = stripMedia(out);
      if (must_contain) {
        const probe = probeMustContain(out, must_contain);
        const excerpts = probe.excerpts.length > 0 ? probe.excerpts.map((e, i) => `${i + 1}. ${e}`).join("\n") : "_(no context)_";
        return `${probe.verdict} for "${must_contain}" (${url})\n\n${excerpts}`;
      }
      return out;
    }
    // plain without selector but with focus/probe: we have dom, extract plain text via cheerio
    const { load } = await import("cheerio");
    const $ = load(dom);
    let text = $("body").text().trim();
    if (focus) text = focusFilter(text, focus);
    if (links === false) text = stripLinks(text);
    if (media === false) text = stripMedia(text);
    if (must_contain) {
      const probe = probeMustContain(text, must_contain);
      const excerpts = probe.excerpts.length > 0 ? probe.excerpts.map((e, i) => `${i + 1}. ${e}`).join("\n") : "_(no context)_";
      return `${probe.verdict} for "${must_contain}" (${url})\n\n${excerpts}`;
    }
    return text;
  }

  // Should never reach
  return dom;
}

// ---------------------------------------------------------------------------
// Stitch helper — follow rel=next up to 6 parts
// ---------------------------------------------------------------------------

async function fetchStitchedMarkdown(seedUrl: string, opts: FetchWebOptions, seedDom?: string): Promise<string> {
  const MAX_PARTS = 6;
  const MAX_CHARS = 48_000;
  const parts: string[] = [];
  let currentUrl = seedUrl;
  let currentDom: string | null = seedDom ?? null;
  let totalChars = 0;

  for (let i = 0; i < MAX_PARTS; i++) {
    let dom: string;
    if (currentDom !== null) {
      dom = currentDom;
      currentDom = null;
    } else {
      // fetch next page's dom via Browsh
      dom = await browshManager.fetchDom(currentUrl);
    }

    let htmlForMd: string;
    if (opts.selector) {
      const html = selectHtml(dom, opts.selector);
      if (!html) throw new FetchError(`CSS selector '${opts.selector}' matched nothing`, { url: currentUrl });
      htmlForMd = html;
    } else {
      htmlForMd = extractMainHtml(dom);
    }
    let md = await html2markdownConvert(htmlForMd, { domain: currentUrl });
    // apply focus per-part if requested (saves stitching irrelevant parts)
    if (opts.focus) md = focusFilter(md, opts.focus);
    if (opts.links === false) md = stripLinks(md);
    if (opts.media === false) md = stripMedia(md);

    const withMarker = i === 0 ? md : `\n\n---\n\n*(part ${i + 1})* from ${currentUrl}\n\n${md}`;
    if (totalChars + withMarker.length > MAX_CHARS) {
      const remaining = MAX_CHARS - totalChars;
      if (remaining > 500) parts.push(withMarker.slice(0, remaining) + `\n…[stitched truncated at ${MAX_CHARS} chars]`);
      break;
    }
    parts.push(withMarker);
    totalChars += withMarker.length;

    const next = findNextUrl(dom, currentUrl);
    if (!next) break;
    currentUrl = next;
    // small dwell to respect pacing
    await new Promise((r) => setTimeout(r, 300));
  }

  let stitched = parts.join("\n\n");
  if (opts.must_contain) {
    const probe = probeMustContain(stitched, opts.must_contain);
    const excerpts = probe.excerpts.length > 0 ? probe.excerpts.map((e, idx) => `${idx + 1}. ${e}`).join("\n") : "_(no context)_";
    return `${probe.verdict} for "${opts.must_contain}" (stitched ${parts.length} parts)\n\n${excerpts}`;
  }
  return stitched;
}

// ---------------------------------------------------------------------------
// Public entry - internal logic (deadline wrapper outside)
// ---------------------------------------------------------------------------

async function fetchWebInner(opts: FetchWebOptions): Promise<string> {
  const { url, type, selector, max_chars, wait_ms, archive, offset, since_last, links, media } = opts;
  validateUrl(url);
  await assertSafeUrl(url);
  if (!TYPES.includes(type)) {
    throw new FetchError("Unknown type; use one of: plain, html, markdown, pdf.", { url });
  }

  // PDF path: no browser, no settle polling, no truncation. Cache the
  // extracted text only (never the raw bytes). Archive ignored for PDFs.
  if (type === "pdf") {
    const pdfKey = cacheKey(url, "pdf");
    const cached = pageCache.get(pdfKey);
    if (cached) {
      let out = cached;
      // offset for PDF text as well?
      if (offset) out = applyOffset(out, offset);
      // since_last for PDFs?
      if (since_last) {
        const handled = handleSinceLast(url, out, true);
        out = handled.content;
      }
      return out;
    }
    const text = await extractPdf(url);
    pageCache.set(pdfKey, text);
    let out = text;
    if (offset) out = applyOffset(out, offset);
    if (since_last) {
      const handled = handleSinceLast(url, out, true);
      out = handled.content;
    }
    return out;
  }

  // archive=only fast path — skip live fetch entirely
  if (archive === "only") {
    const snap = await fetchWaybackSnapshot(url);
    if (!snap) throw new FetchError(`archive.stale: no Wayback snapshot for ${url} [archive=only]`, { url });
    const rawArchived = await processArchiveSnapshot(snap, opts);
    // Cache clean rendered content BEFORE slicing transforms (offset/since_last/links/media/truncate)
    const archKey = cacheKey(url, `archive-only|${settleKey(opts)}`);
    pageCache.set(archKey, rawArchived);
    // Slicing/transforms happen on read path after cache retrieval
    let processed = rawArchived;
    if (offset) processed = applyOffset(processed, offset);
    if (links === false) processed = stripLinks(processed);
    if (media === false) processed = stripMedia(processed);
    if (since_last) {
      const handled = handleSinceLast(url, processed, true);
      processed = handled.content;
    }
    return truncate(processed, max_chars);
  }

  const key = cacheKey(url, settleKey(opts));
  const cached = pageCache.get(key);
  if (cached) {
    let out = cached;
    if (offset) out = applyOffset(out, offset);
    if (since_last) {
      const handled = handleSinceLast(url, out, true);
      if (!handled.changed) return handled.content; // collapsed to one-liner, respect max_chars still
      out = handled.content;
    }
    if (links === false) out = stripLinks(out);
    if (media === false) out = stripMedia(out);
    return truncate(out, max_chars);
  }

  await browshManager.ensureStarted();

  // stitch is a multi-page flow — bypass normal render polling
  if (opts.stitch && type === "markdown") {
    try {
      const rawStitched = await fetchStitchedMarkdown(url, opts);
      // Cache clean rendered content BEFORE slicing transforms
      pageCache.set(key, rawStitched);
      // Slicing/transforms happen on read path after cache retrieval
      let stitched = rawStitched;
      if (offset) stitched = applyOffset(stitched, offset);
      if (links === false) stitched = stripLinks(stitched);
      if (media === false) stitched = stripMedia(stitched);
      if (since_last) {
        const handled = handleSinceLast(url, stitched, true);
        stitched = handled.content;
      }
      return truncate(stitched, max_chars);
    } catch (e) {
      // stitch fallback: if archive=auto and stitch failed hard, try Wayback for seed
      if (archive === "auto" && isHardFailure(e)) {
        const snap = await fetchWaybackSnapshot(url);
        if (snap) {
          const rawProcessed = await processArchiveSnapshot(snap, opts);
          pageCache.set(key, rawProcessed);
          let processed = rawProcessed;
          if (offset) processed = applyOffset(processed, offset);
          if (since_last) {
            const h = handleSinceLast(url, processed, true);
            processed = h.content;
          }
          return truncate(processed, max_chars);
        }
      }
      throw e;
    }
  }

  try {
    const rawRendered = await render(opts);
    // Cache clean rendered content BEFORE slicing transforms (offset/since_last/links/media/truncate)
    pageCache.set(key, rawRendered);
    // Slicing/transforms happen on read path after cache retrieval
    let result = rawRendered;
    if (offset) result = applyOffset(result, offset);
    if (links === false) result = stripLinks(result);
    if (media === false) result = stripMedia(result);
    if (since_last) {
      const handled = handleSinceLast(url, result, true);
      result = handled.content;
    }
    return truncate(result, max_chars);
  } catch (e) {
    if (archive === "auto" && isHardFailure(e)) {
      const snap = await fetchWaybackSnapshot(url);
      if (snap) {
        const rawProcessed = await processArchiveSnapshot(snap, opts);
        pageCache.set(key, rawProcessed);
        let processed = rawProcessed;
        if (offset) processed = applyOffset(processed, offset);
        if (since_last) {
          const h = handleSinceLast(url, processed, true);
          processed = h.content;
        }
        // archived content is cached under same key with banner so re-fetch is stable (clean stored, sliced on read)
        return truncate(processed, max_chars);
      }
    }
    throw e;
  }
}

export async function fetchWeb(opts: FetchWebOptions): Promise<string> {
  // deadline_ms wrapper — honest deadline.hit error, never silent hang
  if (opts.deadline_ms && opts.deadline_ms > 0) {
    const ms = Math.max(500, Math.min(600_000, opts.deadline_ms));
    const deadlineError = new FetchError(`deadline.hit: fetch timed out after ${ms}ms for ${opts.url}`, { url: opts.url });
    (deadlineError as unknown as { code?: string }).code = "deadline.hit";
    return Promise.race([
      fetchWebInner(opts),
      new Promise<string>((_, reject) => setTimeout(() => reject(deadlineError), ms)),
    ]);
  }
  return fetchWebInner(opts);
}

async function processArchiveSnapshot(snap: WaybackSnapshot, opts: FetchWebOptions): Promise<string> {
  const { url } = opts;
  // snapshot.html is raw HTML; run same post-processing as live dom
  let content: string;
  try {
    content = await processDomForType(snap.html, url, opts);
  } catch (e) {
    // if section/focus processing failed, fall back to basic markdown
    const fallbackHtml = extractMainHtml(snap.html);
    content = await html2markdownConvert(fallbackHtml, { domain: url });
    if (opts.focus) content = focusFilter(content, opts.focus);
    if (opts.links === false) content = stripLinks(content);
    if (opts.media === false) content = stripMedia(content);
  }
  const dateStr = snap.timestamp ? `${snap.timestamp.slice(0, 4)}-${snap.timestamp.slice(4, 6)}-${snap.timestamp.slice(6, 8)}` : snap.timestamp;
  return `> [archive snapshot from ${dateStr} via Wayback Machine — live fetch failed, serving archived copy: ${snap.url}]\n\n${content}`;
}

/** Renders, polling until stable when wait_ms > 0. */
async function render(opts: FetchWebOptions): Promise<string> {
  const { wait_ms } = opts;
  const deadline = (wait_ms ?? 0) > 0 ? Date.now() + wait_ms! : 0;

  let previous = "";
  let current = "";
  for (;;) {
    current = await renderOnce(opts);
    if (deadline === 0 || Date.now() >= deadline || current === previous) break;
    previous = current;
    await new Promise((r) => setTimeout(r, SETTLE_INTERVAL_MS));
  }
  return current;
}

async function renderOnce(opts: FetchWebOptions): Promise<string> {
  const { url, type, selector, tier } = opts;

  // pdf is handled entirely in fetchWeb() before render() is ever called. If
  // we land here with type "pdf", a regression moved the early-path: fail loud.
  if (type === "pdf") {
    throw new FetchError("Internal error: pdf type must not reach renderOnce", {
      url,
    });
  }

  // Tier handling: "1" = HTTP only (no Browsh), "2" = browser directly (skip sniff)
  const tierMode = tier ?? "auto";
  const needsBrowser = tierMode === "2" || opts.toc || opts.section || opts.focus || opts.must_contain || opts.stitch;

  // Fast path: sniff Content-Type to avoid wasting 30s on non-HTML endpoints.
  // Skip sniff when tier=2 (force browser) or when enhanced params need full rendering.
  if (tierMode !== "2" && !needsBrowser) {
    const sniff = await sniffContentType(url);
    if (sniff && !sniff.isHtml) {
      // Non-HTML content: fetch the body directly (no browser needed).
      if (sniff.status >= 400) {
        throw new FetchError(
          `HTTP ${sniff.status} from ${url} (Content-Type: ${sniff.contentType})`,
          { statusCode: sniff.status, url }
        );
      }
      try {
        const res = await axios.get(url, {
          timeout: SNIFF_TIMEOUT_MS,
          maxRedirects: 5,
          maxContentLength: NON_HTML_MAX_BYTES,
          responseType: "text",
        });
        let text = String(res.data);
        if (opts.focus) text = focusFilter(text, opts.focus);
        if (opts.must_contain) {
          const probe = probeMustContain(text, opts.must_contain);
          const excerpts = probe.excerpts.length > 0 ? probe.excerpts.map((e, i) => `${i + 1}. ${e}`).join("\n") : "_(no context)_";
          return `${probe.verdict} for "${opts.must_contain}" (${url})\n\n${excerpts}`;
        }
        // links/media not relevant for non-HTML (JSON/text)
        return truncate(text, opts.max_chars);
      } catch (e) {
        // Axios throws ERR_BAD_RESPONSE when maxContentLength is exceeded.
        if (axios.isAxiosError(e) && e.code === "ERR_BAD_RESPONSE") {
          throw new FetchError(
            `Non-HTML response from ${url} exceeds ${NON_HTML_MAX_BYTES} byte safety cap`,
            { url }
          );
        }
        throw new FetchError(
          `Failed to fetch non-HTML content from ${url}: ${e instanceof Error ? e.message : String(e)}`,
          { url }
        );
      }
    }
  }

  // Tier 1: HTTP only — bypass Browsh entirely, fetch via axios
  if (tierMode === "1") {
    try {
      const res = await axios.get(url, {
        timeout: SNIFF_TIMEOUT_MS * 2,
        maxRedirects: 5,
        responseType: "text",
        maxContentLength: NON_HTML_MAX_BYTES,
      });
      if (res.status >= 400) throw new FetchError(`Request failed with status ${res.status}`, { statusCode: res.status, url });
      const ct = String(res.headers["content-type"] ?? "").toLowerCase();
      const isHtml = HTML_CONTENT_TYPES.some((t) => ct.includes(t)) || ct === "" || ct.includes("text/html");
      if (!isHtml) {
        let text = String(res.data);
        if (opts.focus) text = focusFilter(text, opts.focus);
        return text;
      }
      // For HTML via HTTP-only, convert directly without Browsh (may miss JS content — honest limitation of tier 1)
      const dom = String(res.data);
      return processDomForType(dom, url, opts);
    } catch (e) {
      if (e instanceof FetchError) throw e;
      throw new FetchError(`tier 1: HTTP-only fetch failed for ${url}: ${e instanceof Error ? e.message : String(e)}`, { url });
    }
  }

  // plain without selector and without enhanced params → Browsh terminal text (fast path)
  if (type === "plain" && !selector && !opts.toc && !opts.section && !opts.focus && !opts.must_contain) {
    return browshManager.fetchPlain(url);
  }

  const dom = await browshManager.fetchDom(url);

  // Delegated processing handles toc/section/focus/must_contain for all types
  // For html/markdown/plains with enhanced params, processDomForType covers it.
  // For simple html/plains without enhanced params, keep legacy fast logic but reuse processor for consistency.
  const hasEnhanced = opts.toc || opts.section || opts.focus || opts.must_contain || opts.links === false || opts.media === false;
  if (hasEnhanced) {
    return processDomForType(dom, url, opts);
  }

  if (type === "html") {
    if (selector) {
      const html = selectHtml(dom, selector);
      if (html === null) {
        throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
      }
      return html;
    }
    return dom;
  }

  if (type === "markdown") {
    let source = dom;
    if (selector) {
      const html = selectHtml(dom, selector);
      if (html === null) {
        throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
      }
      source = html;
    } else {
      // Boilerplate stripping when no explicit selector is given.
      source = extractMainHtml(dom);
    }
    return html2markdownConvert(source, { domain: url });
  }

  // plain + selector → extract text from the rendered DOM (enhanced case already handled)
  const text = selectText(dom, selector!);
  if (text === null) {
    throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
  }
  return text;
}

function settleKey(o: FetchWebOptions): string {
  const parts = [
    `${(o.wait_ms ?? 0) > 0 ? "w" : "s"}`,
    o.type,
    o.selector ?? "",
    o.focus ?? "",
    o.toc ? "toc" : "",
    o.section ?? "",
    o.must_contain ?? "",
    o.archive ?? "",
    o.stitch ? "stitch" : "",
    o.tier ?? "",
    o.links !== undefined ? `links:${o.links}` : "",
    o.media !== undefined ? `media:${o.media}` : "",
    o.since_last ? "since_last" : "",
    o.deadline_ms !== undefined ? `dl:${o.deadline_ms}` : "",
  ];
  return parts.join("|");
}
