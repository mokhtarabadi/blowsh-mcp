import { browshManager } from "../browshManager.js";
import { html2markdownConvert } from "../html2markdownManager.js";
import { assertSafeUrl } from "../ssrf.js";
import { pageCache, cacheKey } from "../cache.js";
import { extractMainHtml, selectText, selectHtml, truncate } from "../extract.js";
import { FetchError } from "../errors.js";

export interface FetchWebOptions {
  url: string;
  type: "plain" | "html" | "markdown";
  selector?: string;
  max_chars?: number;
  wait_ms?: number;
}

const TYPES = ["plain", "html", "markdown"] as const;
const SETTLE_INTERVAL_MS = 700;

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
 *   `plain`, inner HTML for `html`/`markdown`).
 * @param max_chars Caps the returned output length.
 * @param wait_ms When > 0, polls until the rendered DOM is stable (JS has
 *   settled) or the total wait budget is exhausted.
 */
export async function fetchWeb(opts: FetchWebOptions): Promise<string> {
  const { url, type, selector, max_chars, wait_ms } = opts;
  validateUrl(url);
  await assertSafeUrl(url);
  if (!TYPES.includes(type)) {
    throw new FetchError("Unknown type; use one of: plain, html, markdown.", { url });
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