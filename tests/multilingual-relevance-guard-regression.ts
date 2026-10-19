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

// ── Follow-ups: Hebrew/CJK, wrapper-div, monolingual ranking ───────────────

check(
  "hebrew query yields tokens",
  passesRelevanceGuard("מחיר הדולר היום", "שער החליפין", "https://example.com/fx", "מחיר הדולר היום בתל אביב") === true
);
check(
  "cjk query yields tokens",
  passesRelevanceGuard("美元今日价格走势", "外汇汇率", "https://example.com/fx", "美元今日价格走势") === true
);
check(
  "2-char cjk query stays exempt by design",
  passesRelevanceGuard("unrelated english title", "unrelated snippet", "https://example.com/x", "美元") === true
);

const WRAPPER_HTML = `
<html lang="en"><head><title>Wrapped</title></head><body>
<div class="wrap">
<p lang="en">This domain is for use in documentation examples without needing permission from authorities.</p>
<p lang="ru">Данный домен предназначен для использования в примерах документации без необходимости разрешения.</p>
</div>
</body></html>
`;

const wrapped = extractMainHtml(WRAPPER_HTML);
check("mixed-lang wrapper loses to english paragraph", wrapped.includes("documentation examples"));
check("mixed-lang wrapper does not leak russian", !wrapped.includes("Данный домен"));

const UNTAG_WRAPPER_HTML = `
<html><head><title>NoLang</title></head><body>
<div class="wrap">
<p lang="en">Untagged wrapper holding documentation examples in english for testing purposes here.</p>
<p lang="ru">Данный домен предназначен для использования в примерах документации для тестирования.</p>
</div>
</body></html>
`;

const untag = extractMainHtml(UNTAG_WRAPPER_HTML);
check("untagged mixed wrapper loses to english paragraph", untag.includes("documentation examples"));
check("untagged mixed wrapper does not leak russian", !untag.includes("Данный домен"));

const MONO_HTML = `
<html><head><title>Mono</title></head><body>
<p>Short note.</p>
<p>This is the longest paragraph on this monolingual page by a clear margin, so length ranking must pick it.</p>
<p>Medium paragraph with some more words here.</p>
</body></html>
`;

const mono = extractMainHtml(MONO_HTML);
check("monolingual ranking picks longest paragraph", mono.includes("longest paragraph"));

const TIE_HTML = `
<html><head><title>Tie</title></head><body>
<p>First paragraph with exactly thirty characters!!</p>
<p>Second paragraph with exactly thirty characters!</p>
</body></html>
`;

const tied = extractMainHtml(TIE_HTML);
check("monolingual tie keeps first paragraph", tied.includes("First paragraph"));

console.log(`\n${passed} checks passed`);
if (process.exitCode) {
  process.exit(process.exitCode);
}
