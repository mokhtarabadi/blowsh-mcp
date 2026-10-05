import { isBlockedPage, parseGoogle, parseStartpage } from "../src/tools/searchWeb.js";

let passed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`ok - ${name}`);
  } else {
    console.error(`fail - ${name} ${detail}`);
    process.exitCode = 1;
  }
}

// ── 1. Google redirect decoding and relative path resolution ───────────────

const GOOGLE_HTML_RELATIVE = `
<html><body>
  <div class="g">
    <a href="/url?q=https://example.com/alpha&amp;sa=U&amp;ved=2ahUKEwj">
      <h3>Alpha Result Title</h3>
    </a>
    <div class="VwiC3b">This is the snippet for alpha.</div>
  </div>
  <div class="g">
    <a href="https://www.google.com/url?q=https://example.com/beta&amp;sa=U">
      <h3>Beta Result Title</h3>
    </a>
    <div class="VwiC3b">This is the snippet for beta.</div>
  </div>
</body></html>
`;

const parsedGoogle = parseGoogle(GOOGLE_HTML_RELATIVE, "https://www.google.com/");
check("google parses relative /url?q= links", parsedGoogle.some((r) => r.url === "https://example.com/alpha"));
check("google parses absolute google.com/url?q= links", parsedGoogle.some((r) => r.url === "https://example.com/beta"));
check("google extracts correct titles", parsedGoogle[0]?.title === "Alpha Result Title");
check("google extracts correct snippets", parsedGoogle[0]?.snippet.includes("snippet for alpha"));

// ── 2. isBlockedPage false positive prevention ─────────────────────────────

const CLEAN_SEARCH_SNIPPET_WITH_BLOCKED_WORDS = `
<html><head><title>Search: unusual traffic fix</title></head><body>
  <div class="g">
    <a href="https://example.com/fix-guide"><h3>How to Fix Unusual Traffic Block</h3></a>
    <div class="VwiC3b">If you see unusual traffic or are asked to prove you are not a robot, follow these steps.</div>
  </div>
</body></html>
`;

check(
  "clean results mentioning unusual traffic and not a robot are NOT blocked",
  isBlockedPage(CLEAN_SEARCH_SNIPPET_WITH_BLOCKED_WORDS) === false
);

const parsedClean = parseGoogle(CLEAN_SEARCH_SNIPPET_WITH_BLOCKED_WORDS, "https://www.google.com/");
check("parseGoogle returns results for search mentioning blocked words", parsedClean.length === 1);

// ── 3. isBlockedPage genuine block detection ───────────────────────────────

const GOOGLE_ROBOT_BLOCK = `
<html><head><title>Sorry...</title></head><body>
  <h1>Our systems have detected unusual traffic from your computer network.</h1>
  <form action="/sorry/index" id="captcha-form">
    <div class="g-recaptcha" data-sitekey="6LfwuyAEAAAAAOBIKTxSB"></div>
  </form>
</body></html>
`;

check("google robot block is detected", isBlockedPage(GOOGLE_ROBOT_BLOCK) === true);
check("parseGoogle returns empty array on robot block", parseGoogle(GOOGLE_ROBOT_BLOCK, "https://www.google.com/").length === 0);

const STARTPAGE_CHALLENGE = `
<html><head><title>Verifying your request - Startpage</title></head><body>
  <h1>Verifying your request</h1>
  <div class="cf-turnstile" data-sitekey="xxx"></div>
</body></html>
`;

check("startpage challenge is detected", isBlockedPage(STARTPAGE_CHALLENGE) === true);
check("parseStartpage returns empty array on challenge", parseStartpage(STARTPAGE_CHALLENGE, "https://www.startpage.com/").length === 0);

// ── 4. Startpage clean parsing ─────────────────────────────────────────────

const STARTPAGE_CLEAN = `
<html><head><title>Startpage Search</title></head><body>
  <div class="result">
    <a class="result-title" href="https://example.com/startpage-hit"><h3>Startpage Hit</h3></a>
    <p class="result-snippet">Description from startpage.</p>
  </div>
</body></html>
`;

const parsedStartpage = parseStartpage(STARTPAGE_CLEAN, "https://www.startpage.com/");
check("startpage parses clean result", parsedStartpage.length === 1 && parsedStartpage[0]?.url === "https://example.com/startpage-hit");

console.log(`\n${passed} checks passed`);
if (process.exitCode) {
  process.exit(process.exitCode);
}
