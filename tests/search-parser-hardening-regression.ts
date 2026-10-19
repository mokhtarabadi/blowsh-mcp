import { isBlockedPage, parseGoogle, passesRelevanceGuard } from "../src/tools/searchWeb.js";

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

// ── 1. Blocked page with stale organic containers still resolves to empty ──

const BLOCK_WITH_STALE_ORGANIC = `
<html><head><title>Sorry...</title></head><body>
  <div class="g">
    <a href="https://example.com/stale"><h3>Stale Result</h3></a>
    <div class="VwiC3b">stale snippet</div>
  </div>
  <form action="/sorry/index" id="captcha-form">
    <div class="g-recaptcha" data-sitekey="xxx"></div>
  </form>
</body></html>
`;

check(
  "blocked page with captcha form wins over stale organic containers",
  isBlockedPage(BLOCK_WITH_STALE_ORGANIC) === true
);
check(
  "parseGoogle returns empty on blocked page with stale organics",
  parseGoogle(BLOCK_WITH_STALE_ORGANIC, "https://www.google.com/").length === 0
);

// ── 2. Mixed ads/nav/footer anchors are dropped, organics kept ─────────────

const MIXED_GOOGLE = `
<html><body>
  <div class="g">
    <a href="/url?q=https://example.com/nodejs-guide&sa=U"><h3>Node.js Best Practices Guide</h3></a>
    <div class="VwiC3b">Learn nodejs patterns and best practices.</div>
  </div>
  <a href="/advanced_search">Advanced search</a>
  <a href="https://www.google.com/preferences">Preferences</a>
  <a href="https://www.google.com/url?q=https://ads.example.com/track&sa=U">Sponsored ad link text here</a>
</body></html>
`;

const mixed = parseGoogle(MIXED_GOOGLE, "https://www.google.com/");
check("mixed page keeps the one organic result", mixed.length === 1);
check(
  "mixed page keeps correct organic URL",
  mixed[0]?.url === "https://example.com/nodejs-guide"
);

// ── 3. Relevance guard drops zero-overlap garbage, keeps matches ────────────

check(
  "relevance guard drops unrelated language garbage",
  passesRelevanceGuard("室内设计师找素材", "搜素类 Pinterest 设计", "https://www.zhihu.com/question/1", "Node.js library scrape Google SERP parser") === false
);
check(
  "relevance guard keeps genuine match",
  passesRelevanceGuard("Node.js SERP parser library", "parse Google search results", "https://github.com/example/serp", "Node.js library scrape Google SERP parser") === true
);
check(
  "relevance guard exempts synthetic Instant Answer",
  passesRelevanceGuard("Instant Answer", "abstract", "", "anything unrelated") === true
);
check(
  "genuine page mentioning block words is NOT blocked",
  isBlockedPage(`<html><head><title>Search: unusual traffic fix</title></head><body><div class="g"><a href="https://example.com/x"><h3>Fix</h3></a><div class="VwiC3b">guide</div></div></body></html>`) === false
);
check(
  "docs path on engine domain survives deny-list",
  passesRelevanceGuard("Brave download", "download browser", "https://brave.com/download", "brave download browser") === true
);

console.log(`\n${passed} checks passed`);
if (process.exitCode) {
  process.exit(process.exitCode);
}
