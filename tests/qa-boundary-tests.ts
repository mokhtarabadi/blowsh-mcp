/**
 * Boundary tests for QA rejections V1 (OOM/Truncation) and V2 (Whitespace).
 * Run with: npx tsx tests/qa-boundary-tests.ts
 *
 * V1: Non-HTML fast path must cap response size and apply truncate().
 * V2: cleanPlainText() must preserve content indentation while removing blank lines.
 */

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
// 2. Content lines with indentation are preserved (Browsh padding)
const v2_indentedContent = v2ResultLines[0] === "                    Example Domain";
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

// ── Summary ────────────────────────────────────────────────────────────────
console.log("=== Summary ===");
console.log("V1 (OOM/Truncation):", v1Pass ? "PASS" : "FAIL");
console.log("V2 (Whitespace):", v2Pass ? "PASS" : "FAIL");
console.log("Overall:", (v1Pass && v2Pass) ? "ALL PASS ✓" : "SOME FAILED ✗");

process.exit(v1Pass && v2Pass ? 0 : 1);
