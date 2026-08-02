import { load, type CheerioAPI } from "cheerio";

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "svg",
  "canvas",
  "form",
  "nav",
  "footer",
  "header",
  "aside",
  "button",
  "input",
  "select",
  "textarea",
  "dialog",
  "[hidden]",
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
  '[aria-hidden="true"]',
];

function stripNoise($: CheerioAPI): void {
  for (const sel of NOISE_SELECTORS) {
    try {
      $(sel).remove();
    } catch {
      /* invalid selector, skip */
    }
  }
}

/**
 * Readability-style main-content extraction: prefers <main>, falls back to
 * <article>, then the largest text-density block, finally <body>.
 * Always strips nav/footer/header/aside/scripts/style.
 */
export function extractMainHtml(html: string): string {
  const $ = load(html);
  stripNoise($);

  const candidates: string[] = ["main", "article", '[role="main"]', '[id="content"]', '[id="main"]', '[class*="content"]'];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length > 0) {
      const textLen = el.text().trim().length;
      if (textLen > 50) return el.html() ?? "";
    }
  }

  let best = "";
  let bestLen = 0;
  $("div, section, p").each((_, el) => {
    const textLen = $(el).text().trim().length;
    if (textLen > bestLen) {
      bestLen = textLen;
      best = $(el).html() ?? "";
    }
  });
  if (bestLen > 100) return best;

  return $("body").html() ?? "";
}

/** Extracts the text content of a CSS selector (first match), or null. */
export function selectText(html: string, selector: string): string | null {
  const $ = load(html);
  const el = $(selector).first();
  return el.length > 0 ? el.text().trim() : null;
}

/** Extracts the inner HTML of a CSS selector (first match), or null. */
export function selectHtml(html: string, selector: string): string | null {
  const $ = load(html);
  const el = $(selector).first();
  return el.length > 0 ? (el.html() ?? "") : null;
}

/** Truncates a string to maxChars, keeping a visible marker. */
export function truncate(text: string, maxChars?: number): string {
  if (!maxChars || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const end = cut.lastIndexOf("\n");
  return `${cut.slice(0, end > maxChars / 2 ? end : maxChars)}\n…[truncated at ${maxChars} chars, ${text.length - maxChars} more]`;
}