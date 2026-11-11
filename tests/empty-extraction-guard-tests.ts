/**
 * Empty-extraction guard regression tests (fetch_web silent empty body).
 * Run with: npx tsx tests/empty-extraction-guard-tests.ts
 *
 * Scope: no live network, no Browsh, no html2markdown binary. The renderer is
 * stubbed at the seam the guard sees — a render result carrying the produced
 * content, the rendered DOM char count, and the renderer branch label — so the
 * contract "empty extraction never returns as success" is provable on a host
 * where the external binaries are absent.
 *
 * Covered behaviour:
 *  - hasReadableText() classifies markup, whitespace, script/style-only shells
 *  - guardEmptyExtraction() rejects whitespace-only text output with the
 *    stable code `empty.extraction` and a diagnostic naming url, renderer
 *    branch, DOM chars and extracted text chars
 *  - guardEmptyExtraction() keeps the html exemption (markup passes even with
 *    no visible text) and still rejects a blank DOM
 *  - a healthy ~17 KB markdown body passes untouched
 */

import { hasReadableText } from "../src/extract.js";
import { guardEmptyExtraction } from "../src/tools/fetchWeb.js";
import { FetchError } from "../src/errors.js";

// ── Harness (mirrors tests/qa-boundary-tests.ts) ───────────────────────────

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
  if (passed) {
    console.log(`${name}: PASS`);
  } else {
    failures++;
    console.log(`${name}: FAIL${detail ? ` — ${detail}` : ""}`);
  }
}

/** Runs `fn` and reports whether it threw a FetchError with the expected code. */
function throwsEmptyExtraction(fn: () => void): { threw: boolean; error: unknown } {
  try {
    fn();
    return { threw: false, error: null };
  } catch (e) {
    return { threw: true, error: e };
  }
}

/**
 * Renderer stub: exactly the shape renderOnce produces for a JS-heavy SPA that
 * renders a large DOM but yields one newline of text (the observed failure).
 */
function stubEmptyRenderer(): { content: string; domChars: number; source: string } {
  return { content: "\n", domChars: 48_210, source: "browsh-markdown" };
}

const OBSERVED_URL = "https://platform.openai.com/docs/api-reference/moderations";

// ── hasReadableText ────────────────────────────────────────────────────────

console.log("=== hasReadableText ===");

check("empty string has no readable text", hasReadableText("") === false);
check("whitespace-only markup has no readable text", hasReadableText("\n\n   \t\n") === false);
check(
  "script/style-only shell has no readable text",
  hasReadableText("<html><body><script>var a=1;</script><style>.a{color:red}</style><div id=\"root\"></div></body></html>") === false
);
check(
  "paragraph markup has readable text",
  hasReadableText("<main><h1>Moderation</h1><p>The moderations endpoint classifies text.</p></main>") === true
);

// ── guardEmptyExtraction: text types ───────────────────────────────────────

console.log("=== guardEmptyExtraction (markdown / plain) ===");

const stubbed = stubEmptyRenderer();
const emptyMarkdown = throwsEmptyExtraction(() =>
  guardEmptyExtraction(stubbed.content, {
    url: OBSERVED_URL,
    type: "markdown",
    domChars: stubbed.domChars,
    source: stubbed.source,
  })
);

check("stubbed empty renderer throws", emptyMarkdown.threw);
check(
  "throw is a FetchError with code empty.extraction",
  emptyMarkdown.error instanceof FetchError &&
    (emptyMarkdown.error as FetchError).code === "empty.extraction",
  `got ${emptyMarkdown.error instanceof Error ? `${emptyMarkdown.error.name}/${(emptyMarkdown.error as FetchError).code}` : String(emptyMarkdown.error)}`
);

const message = emptyMarkdown.error instanceof Error ? emptyMarkdown.error.message : "";
check("message names the url", message.includes(OBSERVED_URL), message);
check("message names the renderer branch", message.includes("browsh-markdown"), message);
check("message reports the rendered DOM size", message.includes("48210"), message);
check("message reports the extracted text size", message.includes("text 0 chars"), message);

const whitespaceOnly = throwsEmptyExtraction(() =>
  guardEmptyExtraction("   \n\t \n", {
    url: OBSERVED_URL,
    type: "markdown",
    domChars: 1200,
    source: "browsh-markdown",
  })
);
check("whitespace-only markdown throws", whitespaceOnly.threw);

const plainEmpty = throwsEmptyExtraction(() =>
  guardEmptyExtraction("", { url: OBSERVED_URL, type: "plain", domChars: 0, source: "browsh-plain" })
);
check("empty plain output throws", plainEmpty.threw);

const healthyMarkdown = `${"# Moderation API\n\nThe moderations endpoint classifies text and image inputs.\n\n".repeat(220)}`;
check(
  "healthy ~17 KB markdown passes untouched",
  (() => {
    try {
      guardEmptyExtraction(healthyMarkdown, {
        url: "https://docs.avalai.ir/en/api-reference/moderation",
        type: "markdown",
        domChars: 180_000,
        source: "browsh-markdown",
      });
      return healthyMarkdown.length > 16_000;
    } catch {
      return false;
    }
  })()
);

// ── guardEmptyExtraction: html exemption ───────────────────────────────────

console.log("=== guardEmptyExtraction (html exemption) ===");

const htmlShell = '<html><body><div id="root"></div></body></html>';
check(
  "html markup with no visible text passes (shell diagnosis preserved)",
  (() => {
    try {
      guardEmptyExtraction(htmlShell, {
        url: OBSERVED_URL,
        type: "html",
        domChars: htmlShell.length,
        source: "browsh-html",
      });
      return true;
    } catch {
      return false;
    }
  })()
);

const blankHtml = throwsEmptyExtraction(() =>
  guardEmptyExtraction("   ", { url: OBSERVED_URL, type: "html", domChars: 3, source: "browsh-html" })
);
check("blank html throws", blankHtml.threw);

// ── Summary ────────────────────────────────────────────────────────────────

console.log("=== Summary ===");
if (failures > 0) {
  console.log(`Overall: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("Overall: ALL PASS");
process.exit(0);
