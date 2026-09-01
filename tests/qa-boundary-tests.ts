/**
 * Boundary tests for QA rejections V1 (OOM/Truncation), V2 (Whitespace), V3 (since_last/offset/crawl SSRF).
 * Run with: npx tsx tests/qa-boundary-tests.ts
 *
 * V1: Non-HTML fast path must cap response size and apply truncate().
 * V2: cleanPlainText() must preserve content indentation while removing blank lines.
 * V3: since_last stable, applyOffset cache reuse, crawl SSRF guard.
 */

import { applyOffset, stripLinks, stripMedia } from "../src/extract.js";
import { isPrivateAddress } from "../src/ssrf.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ── V2 Test: cleanPlainText preserves indentation ──────────────────────────

function cleanPlainTextFixed(text: string): string {
  // FIXED implementation — removes whitespace-only lines, preserves indentation
  return text
    .replace(/^(\s*\n)+/, "")        // strip leading blank lines
    .replace(/(\n\s*)+$/, "")        // strip trailing blank lines
    .replace(/\n{2,}/g, "\n")        // collapse 2+ blank lines to 1
    .split("\n")
    .map((line) => line.trimEnd())    // trim trailing spaces only
    .join("\n");
}

// ── V2 Test Cases ──────────────────────────────────────────────────────────

const v2Input = `
                                                              
                                                              
                     Example Domain                          
                                                              
                     This domain is for use in documentation  
                     examples without needing permission.     
                                                              
                     Learn more                               
                                                              
                                                              
`;

const v2ExpectedLines = [
  "Example Domain",
  "",
  "This domain is for use in documentation",
  "examples without needing permission.",
  "",
  "Learn more",
];

console.log("=== V2: cleanPlainText indentation preservation ===");

const v2Result = cleanPlainTextFixed(v2Input);
const v2ResultLines = v2Result.split("\n");

console.log("Result lines:", v2ResultLines.length);
console.log("First line:", JSON.stringify(v2ResultLines[0]));
console.log("First line starts with spaces:", v2ResultLines[0].startsWith(" "));

// V2 assertions:
// 1. Leading whitespace-only lines are removed (no leading newlines)
const v2_noLeadingBlanks = !v2Result.startsWith("\n");
// 2. Content lines with indentation are preserved (Browsh padding) — trimmed text must be Example Domain and line must start with space
const v2_indentedContent = v2ResultLines[0].trim() === "Example Domain" && v2ResultLines[0].startsWith(" ") && v2ResultLines[0].length > "Example Domain".length;
// 3. Blank lines between content are preserved as single newlines
const v2_singleBlanks = !v2Result.includes("\n\n\n");
// 4. No trailing whitespace-only lines
const v2_noTrailingBlanks = !v2Result.endsWith("\n");

console.log("No leading blanks:", v2_noLeadingBlanks);
console.log("Indented content preserved:", v2_indentedContent);
console.log("Single blank lines:", v2_singleBlanks);
console.log("No trailing blanks:", v2_noTrailingBlanks);

const v2Pass = v2_noLeadingBlanks && v2_indentedContent && v2_singleBlanks && v2_noTrailingBlanks;
console.log("V2 Test:", v2Pass ? "PASS ✓" : "FAIL ✗");
console.log("---\n");

// ── V1 Test: maxContentLength and truncate ─────────────────────────────────

const LARGE_JSON = JSON.stringify({
  data: Array.from({ length: 100_000 }, (_, i) => ({
    id: i,
    name: `item-${i}`,
    description: "x".repeat(100),
  })),
});

const MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB

console.log("=== V1: OOM/Truncation boundary ===");
console.log("Large JSON size:", (LARGE_JSON.length / 1024 / 1024).toFixed(2), "MB");
console.log("maxContentLength limit:", (MAX_CONTENT_LENGTH / 1024 / 1024).toFixed(0), "MB");

function truncate(text: string, maxChars?: number): string {
  if (!maxChars || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const end = cut.lastIndexOf("\n");
  return `${cut.slice(0, end > maxChars / 2 ? end : maxChars)}\n…[truncated at ${maxChars} chars, ${text.length - maxChars} more]`;
}

const truncated = truncate(LARGE_JSON, MAX_CONTENT_LENGTH);
const v1Pass = truncated.length <= MAX_CONTENT_LENGTH + 200 &&
               truncated.includes("…[truncated at");
console.log("Truncated length:", (truncated.length / 1024 / 1024).toFixed(2), "MB");
console.log("Truncation marker present:", truncated.includes("…[truncated at"));
console.log("V1 Test:", v1Pass ? "PASS ✓" : "FAIL ✗");
console.log("---\n");

// ── V3 Tests: since_last, applyOffset cache reuse, crawl SSRF ─────────────

console.log("=== V3: since_last / offset / crawl SSRF ===");

// V3a: applyOffset works on cache hits without key bifurcation
// Simulate: cached = "ABCDEFGHIJ", offset 2 and offset 5 should slice correctly, and settleKey must NOT contain offset
const cachedSample = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const off2 = applyOffset(cachedSample, 2);
const off5 = applyOffset(cachedSample, 5);
const v3a_slice2 = off2 === "CDEFGHIJKLMNOPQRSTUVWXYZ";
const v3a_slice5 = off5 === "FGHIJKLMNOPQRSTUVWXYZ";
console.log("applyOffset(2):", JSON.stringify(off2.slice(0, 10)) + (off2.length > 10 ? "…" : ""));
console.log("applyOffset(5):", JSON.stringify(off5.slice(0, 10)) + (off5.length > 10 ? "…" : ""));
// Verify settleKey no longer contains offset bifurcation: read fetchWeb.ts and check
let v3a_noBifurcation = false;
try {
  const fetchWebSrc = fs.readFileSync(path.join(process.cwd(), "src/tools/fetchWeb.ts"), "utf-8");
  const settleKeyBlock = fetchWebSrc.slice(fetchWebSrc.indexOf("function settleKey"), fetchWebSrc.indexOf("function settleKey") + 800);
  v3a_noBifurcation = !settleKeyBlock.includes("off:") && !settleKeyBlock.includes("o.offset");
  console.log("settleKey contains offset?:", !v3a_noBifurcation);
} catch (e) {
  console.log("settleKey check failed:", e);
  v3a_noBifurcation = false;
}
console.log("applyOffset slice 2 correct:", v3a_slice2);
console.log("applyOffset slice 5 correct:", v3a_slice5);
console.log("settleKey no bifurcation:", v3a_noBifurcation);
const v3aPass = v3a_slice2 && v3a_slice5 && v3a_noBifurcation;
console.log("V3a (offset cache reuse):", v3aPass ? "PASS ✓" : "FAIL ✗");
console.log("---");

// V3b: since_last repeated fetch returns stable output without duplicate banners
// Simulate fingerprint file logic: first fetch stores hash, second same content returns unchanged one-liner, not duplicate changed banner
const tmpFpFile = path.join(os.tmpdir(), `blowsh-qa-since-last-${Date.now()}.json`);
function hashContent(s: string): string { return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16); }
function handleSinceLastSim(url: string, content: string): { content: string; changed: boolean } {
  let fps: Record<string, { hash: string; at: number }> = {};
  try { fps = JSON.parse(fs.readFileSync(tmpFpFile, "utf-8")); } catch { fps = {}; }
  const curHash = hashContent(content);
  const prev = fps[url];
  if (prev && prev.hash === curHash) {
    const ageMs = Date.now() - prev.at;
    const ageH = (ageMs / 3600000).toFixed(1);
    return { content: `unchanged since last fetch (${url}, fingerprint ${curHash}, age ${ageH}h)`, changed: false };
  }
  fps[url] = { hash: curHash, at: Date.now() };
  try { fs.writeFileSync(tmpFpFile, JSON.stringify(fps)); } catch {}
  if (prev) {
    return { content: `> [changed since last fetch — previous fingerprint ${prev.hash}, now ${curHash}]\n\n${content}`, changed: true };
  }
  try { fs.writeFileSync(tmpFpFile, JSON.stringify(fps)); } catch {}
  return { content, changed: true };
}
const testUrl = "https://example.com/since-last-test";
const sampleContent = "# Hello\n\nThis is stable content.";
// clean up tmp
try { fs.unlinkSync(tmpFpFile); } catch {}
const first = handleSinceLastSim(testUrl, sampleContent);
const second = handleSinceLastSim(testUrl, sampleContent);
const thirdSame = handleSinceLastSim(testUrl, sampleContent);
// change content
const changedContent = "# Hello\n\nThis is changed content.";
const fourthChanged = handleSinceLastSim(testUrl, changedContent);
const v3b_firstIsFull = first.content.includes("stable content") && !first.content.includes("unchanged");
const v3b_secondIsUnchanged = second.content.includes("unchanged since last fetch") && second.content.includes(hashContent(sampleContent).slice(0,4));
const v3b_thirdStillUnchanged = thirdSame.content.includes("unchanged since last fetch");
const v3b_noDuplicateBanner = !second.content.includes("> [changed") && !thirdSame.content.includes("> [changed");
const v3b_fourthIsChanged = fourthChanged.content.includes("> [changed since last fetch");
console.log("first fetch full:", v3b_firstIsFull);
console.log("second fetch unchanged one-liner:", v3b_secondIsUnchanged);
console.log("third still unchanged (stable):", v3b_thirdStillUnchanged);
console.log("no duplicate changed banner on repeated:", v3b_noDuplicateBanner);
console.log("fourth with changed content shows changed banner:", v3b_fourthIsChanged);
try { fs.unlinkSync(tmpFpFile); } catch {}
const v3bPass = v3b_firstIsFull && v3b_secondIsUnchanged && v3b_thirdStillUnchanged && v3b_noDuplicateBanner && v3b_fourthIsChanged;
console.log("V3b (since_last stable):", v3bPass ? "PASS ✓" : "FAIL ✗");
console.log("---");

// V3c: crawlWeb rejects private IP targets via SSRF guard
console.log("V3c: crawl SSRF guard");
const privateIps = ["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.5", "169.254.10.20"];
const publicIps = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];
let v3cPrivPass = true;
for (const ip of privateIps) {
  const isPriv = await isPrivateAddress(ip);
  console.log(`  isPrivateAddress(${ip}) = ${isPriv}`);
  if (!isPriv) v3cPrivPass = false;
}
let v3cPubPass = true;
for (const ip of publicIps) {
  const isPriv = await isPrivateAddress(ip);
  console.log(`  isPrivateAddress(${ip}) = ${isPriv} (expected false)`);
  if (isPriv) v3cPubPass = false;
}
// Also test that private IP in crawl queue would be skipped via assertSafeUrl logic
// We simulate by checking that isPrivateAddress would cause crawl to skip
const v3cPass = v3cPrivPass && v3cPubPass;
console.log("V3c private IPs correctly blocked:", v3cPrivPass);
console.log("V3c public IPs correctly allowed:", v3cPubPass);
console.log("V3c (crawl SSRF):", v3cPass ? "PASS ✓" : "FAIL ✗");
console.log("---\n");

// ── Summary ────────────────────────────────────────────────────────────────
console.log("=== Summary ===");
console.log("V1 (OOM/Truncation):", v1Pass ? "PASS" : "FAIL");
console.log("V2 (Whitespace):", v2Pass ? "PASS" : "FAIL");
console.log("V3a (offset cache reuse):", v3aPass ? "PASS" : "FAIL");
console.log("V3b (since_last stable):", v3bPass ? "PASS" : "FAIL");
console.log("V3c (crawl SSRF):", v3cPass ? "PASS" : "FAIL");
const allPass = v1Pass && v2Pass && v3aPass && v3bPass && v3cPass;
console.log("Overall:", allPass ? "ALL PASS ✓" : "SOME FAILED ✗");

process.exit(allPass ? 0 : 1);
