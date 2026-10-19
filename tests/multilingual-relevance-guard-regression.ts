import { passesRelevanceGuard } from "../src/tools/searchWeb.js";
import { extractMainHtml } from "../src/extract.js";

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

// ── B1: non-Latin queries must yield tokens, not exemptions ────────────────

const FA_QUERY = "قیمت دلار امروز تهران";

check(
  "persian query matches persian result",
  passesRelevanceGuard("قیمت دلار امروز در تهران", "نرخ ارز و قیمت دلار", "https://example.com/dollar", FA_QUERY) === true
);
check(
  "persian query drops english job-site garbage",
  passesRelevanceGuard("Recommended Jobs For You", "Search millions of open jobs", "https://www.glassdoor.com/Job/index.htm", FA_QUERY) === false
);
check(
  "arabic query yields tokens",
  passesRelevanceGuard("سعر الدولار اليوم", "أسعار العملات", "https://example.com/fx", "سعر الدولار اليوم في القاهرة") === true
);
check(
  "cyrillic query yields tokens",
  passesRelevanceGuard("курс доллара сегодня", "обмен валюты", "https://example.com/fx", "курс доллара сегодня") === true
);
check(
  "empty query stays exempt",
  passesRelevanceGuard("anything", "anything", "https://example.com/x", "  ") === true
);
check(
  "instant answer stays exempt",
  passesRelevanceGuard("Instant Answer", "abstract", "", FA_QUERY) === true
);

// ── B2: multi-lang page must prefer the English paragraph ──────────────────

const MULTI_LANG_HTML = `
<html lang="en"><head><title>Example Domain</title></head><body>
<p lang="en">This domain is for use in documentation examples without needing permission.</p>
<p lang="ar" dir="rtl">هذا النطاق مخصص للاستخدام في أمثلة التوثيق.</p>
<p lang="zh">该域名仅用于文档示例。</p>
<p lang="fr">L'usage de ce domaine est réservé à des exemples.</p>
<p lang="ru">Данный домен предназначен для использования в примерах.</p>
</body></html>
`;

const main = extractMainHtml(MULTI_LANG_HTML);
check("multi-lang extraction prefers english paragraph", main.includes("documentation examples"));
check("multi-lang extraction does not pick russian paragraph", !main.includes("Данный домен"));

console.log(`\n${passed} checks passed`);
if (process.exitCode) {
  process.exit(process.exitCode);
}
