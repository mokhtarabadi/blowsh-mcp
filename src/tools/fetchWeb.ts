import { browshManager } from "../browshManager.js";
import { html2markdownConvert } from "../html2markdownManager.js";
import { extractPdf } from "./extractPdf.js";
import { assertSafeUrl } from "../ssrf.js";
import { pageCache, cacheKey } from "../cache.js";
import { extractMainHtml, selectText, selectHtml, truncate } from "../extract.js";
import { FetchError } from "../errors.js";
import axios from "axios";

export interface FetchWebOptions {
  url: string;
  type: "plain" | "html" | "markdown" | "pdf";
  selector?: string;
  max_chars?: number;
  wait_ms?: number;
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
      res = await axios.get(url, {
        timeout: SNIFF_TIMEOUT_MS,
        maxRedirects: 5,
        maxContentLength: 0, // don't download body
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

/**
 * Fetches a web page (after full JS rendering) as plain text, HTML, or Markdown.
 * Throws FetchError on failure so clients can detect errors structurally.
 *
 * @param selector When set, only the matched element is returned (text for
 *   `plain`, inner HTML for `html`/`markdown`). Ignored for `pdf`.
 * @param max_chars Caps the returned output length. Not applied to `pdf`.
 * @param wait_ms When > 0, polls until the rendered DOM is stable (JS has
 *   settled) or the total wait budget is exhausted. Ignored for `pdf`.
 *
 * `type: "pdf"` bypasses the browser entirely: the PDF is downloaded directly
 * (SSRF-guarded), size-capped, and piped through `pdftotext`. `selector`,
 * `max_chars`, and `wait_ms` are silently ignored for this type.
 */
export async function fetchWeb(opts: FetchWebOptions): Promise<string> {
  const { url, type, selector, max_chars, wait_ms } = opts;
  validateUrl(url);
  await assertSafeUrl(url);
  if (!TYPES.includes(type)) {
    throw new FetchError("Unknown type; use one of: plain, html, markdown, pdf.", { url });
  }

  // PDF path: no browser, no settle polling, no truncation. Cache the
  // extracted text only (never the raw bytes).
  if (type === "pdf") {
    const pdfKey = cacheKey(url, "pdf");
    const cached = pageCache.get(pdfKey);
    if (cached) return cached;
    const text = await extractPdf(url);
    pageCache.set(pdfKey, text);
    return text;
  }

  const key = cacheKey(url, settleKey(opts));
  const cached = pageCache.get(key);
  if (cached) return truncate(cached, max_chars);

  await browshManager.ensureStarted();
  const result = await render(opts);
  pageCache.set(key, result);
  return truncate(result, max_chars);
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
  const { url, type, selector } = opts;

  // pdf is handled entirely in fetchWeb() before render() is ever called. If
  // we land here with type "pdf", a regression moved the early-path: fail loud.
  if (type === "pdf") {
    throw new FetchError("Internal error: pdf type must not reach renderOnce", {
      url,
    });
  }

  // Fast path: sniff Content-Type to avoid wasting 30s on non-HTML endpoints.
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
      return truncate(String(res.data), opts.max_chars);
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

  // plain without selector → Browsh terminal text (fast path)
  if (type === "plain" && !selector) {
    return browshManager.fetchPlain(url);
  }

  const dom = await browshManager.fetchDom(url);

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

  // plain + selector → extract text from the rendered DOM
  const text = selectText(dom, selector!);
  if (text === null) {
    throw new FetchError(`CSS selector '${selector}' matched nothing`, { url });
  }
  return text;
}

function settleKey(o: FetchWebOptions): string {
  return `${(o.wait_ms ?? 0) > 0 ? "w" : "s"}|${o.type}|${o.selector ?? ""}`;
}