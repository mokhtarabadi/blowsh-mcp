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

// ---------------------------------------------------------------------------
// Focus (BM25-lite relevance filter) — token-economy helper
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "of", "in", "on", "at", "to", "for", "and", "or", "what", "which", "how", "do", "does", "i", "you", "it", "this", "that", "with", "as", "by", "be", "has", "have", "had", "from", "but", "not", "we", "they", "he", "she", "its", "our", "your",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

function bm25LiteScore(blockTokens: string[], queryTokens: string[], avgLen: number): number {
  const k1 = 1.2;
  const b = 0.75;
  const blockLen = blockTokens.length || 1;
  const freq = new Map<string, number>();
  for (const t of blockTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  let score = 0;
  for (const q of queryTokens) {
    const tf = freq.get(q) ?? 0;
    if (tf === 0) continue;
    // idf approximated as 1 (corpus-agnostic); TF normalization gives length-aware boost
    const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + (b * blockLen) / avgLen));
    score += norm;
    // partial match boost: substring contained
    if (blockTokens.some((t) => t.includes(q) || q.includes(t)) && !freq.has(q)) {
      score += 0.3;
    }
  }
  // exact phrase boost
  const blockText = blockTokens.join(" ");
  const queryText = queryTokens.join(" ");
  if (queryTokens.length > 1 && blockText.includes(queryText)) score += 0.8;
  return score;
}

/**
 * BM25-lite focus filter: keeps only blocks relevant to `query`.
 * Blocks are split on double-newline (markdown paragraphs). Returns filtered
 * markdown or the original with a notice when nothing matches.
 */
export function focusFilter(markdown: string, query: string): string {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return markdown;
  const rawBlocks = markdown.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (rawBlocks.length === 0) return markdown;
  const tokenized = rawBlocks.map((b) => tokenize(b));
  const avgLen = tokenized.reduce((a, t) => a + t.length, 0) / tokenized.length || 1;
  const scored = rawBlocks.map((block, i) => ({
    block,
    score: bm25LiteScore(tokenized[i] ?? [], queryTokens, avgLen),
  }));
  const kept = scored.filter((s) => s.score > 0.25).map((s) => s.block);
  if (kept.length === 0) {
    return `[focus: no blocks matched query "${query}", returning full page]\n\n${markdown}`;
  }
  const pct = Math.round((1 - kept.join("\n\n").length / markdown.length) * 100);
  const header = `> Focus filter "${query}" kept ${kept.length}/${rawBlocks.length} blocks (~${pct}% reduction)\n\n`;
  return header + kept.join("\n\n");
}

// ---------------------------------------------------------------------------
// TOC & Section extraction
// ---------------------------------------------------------------------------

/**
 * Heading outline — one line per heading with level, text, and char estimate.
 * Used for `toc=true` cheap outline before targeting a section.
 */
export function extractToc(html: string): string {
  const $ = load(html);
  stripNoise($);
  const lines: string[] = ["# Table of Contents", ""];
  let count = 0;
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = headingLevel(tagNameOf(el)) || 2;
    const text = cleanHeadingText($, el);
    if (!text) return;
    count++;
    const indent = "  ".repeat(Math.max(0, level - 1));
    // estimate chars in this section (same collector as section mode)
    const body = collectSectionHtml($, $(el), level);
    const chars = Math.min(8000, Math.max(0, textLengthOfHtml(body) - text.length));
    lines.push(`${indent}- ${text} (h${level}, ~${chars} chars)`);
  });
  if (count === 0) return "# Table of Contents\n\n_(no headings found — page has no h1-h6)_";
  lines.push("", `_${count} headings — use section="heading text" to fetch one_`);
  return lines.join("\n");
}

function tagNameOf(node: unknown): string {
  const n = node as { name?: unknown; tagName?: unknown };
  const raw = typeof n.name === "string" ? n.name : typeof n.tagName === "string" ? n.tagName : "";
  return raw.toLowerCase();
}

function isHeadingTag(tag: string): boolean {
  return /^h[1-6]$/.test(tag);
}

function headingLevel(tag: string): number {
  const m = /^h([1-6])$/.exec(tag);
  return m ? Number(m[1]) : 0;
}

/**
 * Heading text with edit-link anchors stripped ("Experimental progress [edit]" → "Experimental progress").
 */
function cleanHeadingText($: CheerioAPI, el: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clone = $((el as any)).clone();
  clone.find(".mw-editsection, .editsection, .edit-link").remove();
  return clone.text().trim().replace(/\s+/g, " ").replace(/\s*\[edit\]\s*$/i, "");
}

/** Visible text length of an HTML fragment (tags stripped). */
function textLengthOfHtml(html: string): number {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

function nodeClassList(node: unknown): string[] {
  const cls = (node as { attribs?: Record<string, string> }).attribs?.["class"] ?? "";
  return cls.split(/\s+/).filter(Boolean);
}

function isEditSectionNode(node: unknown): boolean {
  if ((node as { type?: string }).type === "text") return false;
  const cls = nodeClassList(node);
  return cls.includes("mw-editsection") || cls.includes("editsection");
}

function isBlankTextNode(node: unknown): boolean {
  const n = node as { type?: string; data?: unknown };
  return n.type === "text" && (typeof n.data !== "string" || n.data.trim().length === 0);
}

/**
 * Hoist a heading to its wrapper (e.g. Wikipedia `div.mw-heading` which holds
 * only the h2 + edit-link span). Climbs through div ancestors that contain
 * nothing but the heading subtree, edit spans, and blank text.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hoistHeading(target: any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let root: any = target;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parent: any = target.parent();
  while (parent.length > 0 && (parent.get(0)?.tagName ?? "").toLowerCase() === "div") {
    const kids: unknown[] = parent.contents().toArray();
    const meaningful = kids.filter(
      (k) => k !== root.get(0) && !isEditSectionNode(k) && !isBlankTextNode(k)
    );
    if (meaningful.length > 0) break;
    root = parent;
    parent = parent.parent();
  }
  return root;
}

/**
 * Collect heading + section body HTML. Sibling walk first (standard article
 * markup); document-order walk fallback for DOMs where content is nested in
 * containers instead of flat siblings (e.g. browser-rendered pages).
 * Edit-link spans are never collected. Collection walks from the hoisted
 * wrapper so wrapped headings (`div.mw-heading > h2 + span.mw-editsection`) work.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectSectionHtml($: CheerioAPI, target: any, targetLevel: number): string {
  const root = hoistHeading(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sectionHtml = ($.html(target as any) ?? "") as string;
  const headLen = textLengthOfHtml(sectionHtml);
  // pass 1: flat siblings of the (possibly hoisted) root until next heading of same/higher level
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let next: any = root.next();
  while (next.length > 0) {
    const node = next.get(0);
    if (!isEditSectionNode(node)) {
      const tag = tagNameOf(node);
      if (isHeadingTag(tag) && headingLevel(tag) <= targetLevel) break;
      sectionHtml += $.html(next) ?? "";
    }
    next = next.next();
    if (sectionHtml.length > 200_000) break; // safety cap
  }
  if (textLengthOfHtml(sectionHtml) > headLen) return sectionHtml;
  // pass 2: document-order walk after the wrapper — collect top-level nodes,
  // skipping the wrapper subtree itself and descendants of already-collected
  // containers (no duplicates), stopping at the next heading of same/higher level.
  sectionHtml = $.html(target) ?? "";
  const rootNode = root.get(0);
  const targetNode = target.get(0);
  const collected = new Set<unknown>();
  const all = $("body").find("*").toArray();
  const start = all.findIndex((n) => n === rootNode);
  for (let i = start + 1; i < all.length && sectionHtml.length <= 200_000; i++) {
    const node = all[i] as unknown as Record<string, unknown>;
    if (node === targetNode || isEditSectionNode(node)) continue;
    type ParentRef = Record<string, unknown> | null | undefined;
    let p = node["parent"] as ParentRef;
    let insideWrapper = false;
    while (p && (p as Record<string, unknown>)["type"] !== "root") {
      if (p === rootNode) { insideWrapper = true; break; }
      p = (p as Record<string, unknown>)["parent"] as ParentRef;
    }
    if (insideWrapper) continue;
    const tag = tagNameOf(node);
    if (isHeadingTag(tag) && headingLevel(tag) <= targetLevel) break;
    let q = node["parent"] as ParentRef;
    let skip = false;
    while (q && (q as Record<string, unknown>)["type"] !== "root") {
      if (collected.has(q)) { skip = true; break; }
      q = (q as Record<string, unknown>)["parent"] as ParentRef;
    }
    if (skip) continue;
    collected.add(node);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sectionHtml += $.html(node as any) ?? "";
  }
  return sectionHtml;
}

/**
 * Extract a single section's HTML by heading substring (case-insensitive).
 * Returns the heading + following siblings until next heading of same/higher level.
 */
export function extractSectionHtml(html: string, sectionQuery: string): string | null {
  const $ = load(html);
  stripNoise($);
  const q = sectionQuery.toLowerCase().trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: any = null;
  let targetLevel = 0;
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (target) return;
    const text = cleanHeadingText($, el).toLowerCase();
    if (text.includes(q)) {
      target = $(el);
      targetLevel = headingLevel(tagNameOf(el)) || 2;
    }
  });
  if (!target || targetLevel === 0) return null;
  const sectionHtml = collectSectionHtml($, target, targetLevel);
  return sectionHtml || null;
}

// ---------------------------------------------------------------------------
// Probe mode — must_contain (MATCH/NO-MATCH + excerpts)
// ---------------------------------------------------------------------------

export interface ProbeResult {
  matched: boolean;
  excerpts: string[];
  verdict: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Probe whether `content` contains `pattern`.
 * - Plain string → case-insensitive substring
 * - `/regex/` or `/regex/flags` → RegExp test
 * Returns MATCH/NO-MATCH + up to 3 context excerpts (~80 chars window).
 */
export function probeMustContain(content: string, pattern: string): ProbeResult {
  const trimmed = pattern.trim();
  let regex: RegExp | null = null;
  let isRegex = false;
  if (trimmed.length >= 2 && trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
    const lastSlash = trimmed.lastIndexOf("/");
    if (lastSlash > 0) {
      const body = trimmed.slice(1, lastSlash);
      const flagsRaw = trimmed.slice(lastSlash + 1);
      const flags = flagsRaw || "i";
      try {
        regex = new RegExp(body, flags.includes("i") ? flags : flags + "i");
        isRegex = true;
      } catch {
        regex = null;
        isRegex = false;
      }
    }
  }
  const excerpts: string[] = [];
  let matched = false;

  if (isRegex && regex) {
    const global = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = global.exec(content)) !== null && count < 3) {
      matched = true;
      const idx = m.index;
      const len = m[0].length;
      const start = Math.max(0, idx - 60);
      const end = Math.min(content.length, idx + len + 60);
      let excerpt = content.slice(start, end).replace(/\s+/g, " ").trim();
      if (start > 0) excerpt = "…" + excerpt;
      if (end < content.length) excerpt += "…";
      excerpts.push(excerpt);
      count++;
      if (m[0].length === 0) global.lastIndex++;
    }
  } else {
    const lcContent = content.toLowerCase();
    const lcPattern = trimmed.toLowerCase();
    let from = 0;
    let count = 0;
    while (count < 3) {
      const idx = lcContent.indexOf(lcPattern, from);
      if (idx === -1) break;
      matched = true;
      const start = Math.max(0, idx - 60);
      const end = Math.min(content.length, idx + trimmed.length + 60);
      let excerpt = content.slice(start, end).replace(/\s+/g, " ").trim();
      if (start > 0) excerpt = "…" + excerpt;
      if (end < content.length) excerpt += "…";
      excerpts.push(excerpt);
      from = idx + trimmed.length;
      count++;
    }
  }

  const verdict = matched ? "MATCH" : "NO-MATCH";
  return { matched, excerpts, verdict };
}

// ---------------------------------------------------------------------------
// Stitch helper — find rel=next URL
// ---------------------------------------------------------------------------

export function findNextUrl(html: string, baseUrl: string): string | null {
  const $ = load(html);
  // standard rel=next
  let href: string | undefined | null = $('link[rel="next"]').attr("href") || $('a[rel="next"]').attr("href");
  if (!href) {
    // heuristic: pagination "Next" links
    $('a').each((_, el) => {
      if (href) return;
      const text = $(el).text().trim().toLowerCase();
      const rel = ($(el).attr("rel") ?? "").toLowerCase();
      if (rel === "next" || text === "next" || text === "next →" || text === "next »" || text === "→" || text === "›") {
        href = $(el).attr("href") ?? null;
      }
    });
  }
  if (!href) return null;
  if (/^(javascript|mailto|tel|data|blob|#):/i.test(href)) return null;
  try {
    const abs = new URL(href, baseUrl).toString();
    const baseHost = new URL(baseUrl).hostname;
    const nextHost = new URL(abs).hostname;
    if (baseHost !== nextHost) return null; // same-host only
    return abs;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Links/media stripping (token economy) + offset helper
// ---------------------------------------------------------------------------

/**
 * Strip markdown links: [text](url) → text, and bare URLs optionally.
 * Default DonSeTch behavior: links=false saves ~30% tokens.
 */
export function stripLinks(markdown: string): string {
  // images first: ![alt](url) → alt
  let out = markdown.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  // links: [text](url) → text
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // reference-style links: [text][ref] → text
  out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  return out;
}

/**
 * Strip image markdown: ![alt](url) → "" or alt, and <img> tags.
 * media=false removes image alt text/sources.
 */
export function stripMedia(markdown: string): string {
  // Remove image markdown entirely (including alt)
  let out = markdown.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
  // Remove any remaining <img> HTML tags if present
  out = out.replace(/<img[^>]*>/gi, "");
  return out;
}

/**
 * Apply offset for truncated resumption: slice from offset, keep original
 * marker semantics. DonSeTch structuredContent.next_offset → call again with offset.
 */
export function applyOffset(text: string, offset?: number): string {
  if (!offset || offset <= 0) return text;
  if (offset >= text.length) return "";
  return text.slice(offset);
}