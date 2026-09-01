/**
 * Quick verification for DonSeTch parity features (no Browsh needed).
 * Run: npx tsx tests/verify-donsetch-parity.ts
 */
import {
  focusFilter,
  extractToc,
  extractSectionHtml,
  probeMustContain,
  findNextUrl,
  stripLinks,
  stripMedia,
  applyOffset,
} from "../src/extract.js";

let ok = 0, fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`PASS ${name}`); ok++; }
  else { console.log(`FAIL ${name}${detail ? ": "+detail : ""}`); fail++; }
}

// --- focusFilter ---
const mdSample = `# Introduction\n\nThis is about authentication error handling in Node.js.\n\n# Pricing\n\nWe charge $10 per month.\n\n# Authentication Guide\n\nUse JWT tokens for authentication. Token expiry is 1 hour. Error handling should retry on 401.\n\n# Other\n\nThe weather is sunny today.`;
const focused = focusFilter(mdSample, "authentication error handling");
assert("focus keeps relevant blocks", focused.includes("JWT tokens") && focused.includes("401"));
assert("focus drops pricing", !focused.includes("$10 per month"));
assert("focus drops weather", !focused.includes("weather is sunny"));

// no-match fallback
const noMatch = focusFilter(mdSample, "nonexistentXYZfoobar");
assert("focus no-match returns notice", noMatch.includes("no blocks matched") && noMatch.includes(mdSample.slice(0,20)));

// --- extractToc ---
const htmlSample = `<html><body><h1>Intro</h1><p>hi</p><h2>Getting Started</h2><p>steps</p><h3>Install</h3><p>npm</p><h2>API Reference</h2></body></html>`;
const toc = extractToc(htmlSample);
assert("toc contains headings", toc.includes("Intro") && toc.includes("Getting Started") && toc.includes("Install"));
assert("toc has h1 marker", toc.includes("h1"));

// empty toc
const noHead = extractToc(`<html><body><p>no headings</p></body></html>`);
assert("toc empty notice", noHead.includes("no headings"));

// --- extractSectionHtml ---
const section = extractSectionHtml(htmlSample, "getting started");
assert("section extracts Getting Started", section !== null && section.includes("Getting Started"));
assert("section does not include Intro after", section !== null && !section.includes("API Reference"));

// not found
const notFound = extractSectionHtml(htmlSample, "Nonexistent Heading");
assert("section not found returns null", notFound === null);

// --- probeMustContain substring ---
const probe1 = probeMustContain("The quick brown fox jumps over the lazy dog", "brown fox");
assert("probe substring MATCH", probe1.matched && probe1.verdict === "MATCH" && probe1.excerpts.length === 1);
const probe2 = probeMustContain("The quick brown fox", "cat");
assert("probe substring NO-MATCH", !probe2.matched && probe2.verdict === "NO-MATCH");

// regex
const probe3 = probeMustContain("Version 2.3.0 and CVE-2026-1234 is fixed", "/CVE-2026-\\d+/");
assert("probe regex MATCH", probe3.matched && probe3.excerpts[0].includes("CVE-2026-1234"));
const probe4 = probeMustContain("Hello world", "/notfound\\d+/");
assert("probe regex NO-MATCH", !probe4.matched);

// multiple excerpts
const multi = "foo bar foo bar foo bar foo bar";
const probeMulti = probeMustContain(multi, "foo");
assert("probe multiple excerpts up to 3", probeMulti.excerpts.length === 3);

// --- findNextUrl ---
const pagHtml = `<html><body><a rel="next" href="/page2">Next</a></body></html>`;
const nxt = findNextUrl(pagHtml, "https://example.com/page1");
assert("findNextUrl rel=next", nxt === "https://example.com/page2");

// same-host only
const extHtml = `<html><body><a rel="next" href="https://evil.com/page2">Next</a></body></html>`;
const nxtExt = findNextUrl(extHtml, "https://example.com/page1");
assert("findNextUrl same-host blocks external", nxtExt === null);

// heuristic text=Next
const heurHtml = `<html><body><a href="/p2">Next</a></body></html>`;
const heur = findNextUrl(heurHtml, "https://example.com/p1");
assert("findNextUrl heuristic Next text", heur === "https://example.com/p2");

// no next
const noneHtml = `<html><body><p>no pagination</p></body></html>`;
const none = findNextUrl(noneHtml, "https://example.com/page1");
assert("findNextUrl none returns null", none === null);

// --- stripLinks ---
const mdLinks = `Check [Google](https://google.com) and [Example](https://example.com) here.`;
const stripped = stripLinks(mdLinks);
assert("stripLinks removes URLs", stripped === "Check Google and Example here.");
assert("stripLinks preserves text", stripped.includes("Google") && !stripped.includes("https://"));

// --- stripMedia ---
const mdMedia = `Text ![alt text](https://example.com/img.png) more text <img src="x.png" /> end`;
const noMedia = stripMedia(mdMedia);
assert("stripMedia removes images", !noMedia.includes("!") && !noMedia.includes("<img") && !noMedia.includes("https://example.com/img.png"));
assert("stripMedia preserves surrounding text", noMedia.includes("Text") && noMedia.includes("more text"));

// --- applyOffset ---
const longText = "0123456789ABCDEF";
assert("applyOffset slices correctly", applyOffset(longText, 5) === "56789ABCDEF");
assert("applyOffset zero returns original", applyOffset(longText, 0) === longText);
assert("applyOffset beyond length returns empty", applyOffset(longText, 100) === "");

// --- summary ---
console.log(`\nSummary: ${ok} pass, ${fail} fail of ${ok+fail}`);
process.exit(fail === 0 ? 0 : 1);
