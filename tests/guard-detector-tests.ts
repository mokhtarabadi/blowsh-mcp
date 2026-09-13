/**
 * Guard-detector tests (task 08, A4 + QA hotfix).
 * Run with: npx tsx tests/guard-detector-tests.ts
 *
 * Bot-wall fixtures must flag with the right kind; clean pages — including
 * security-blog prose that mentions two weak words without challenge DOM —
 * must stay clean. Quarantine allowlist and cache-eviction primitives covered.
 */

import { detectGuard, guardTrailer, cacheGuardVerdict, guardVerdictCache } from "../src/guard.js";
import { quarantineProfileDir } from "../src/browshManager.js";
import { TtlCache } from "../src/cache.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name} ${detail}`);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const CLOUDFLARE = `<html><head><title>Just a moment...</title></head><body>
<script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/8d7.js"></script>
<div>Checking your browser before you access example.com</div></body></html>`;

const TURNSTILE = `<html><body><form><div class="cf-turnstile"
data-sitekey="xxx" data-src="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
</form></body></html>`;

const RECAPTCHA = `<html><body><div class="g-recaptcha" data-sitekey="yyy"></div>
<script src="https://www.google.com/recaptcha/api.js"></script></body></html>`;

const HCAPTCHA = `<html><body><div class="h-captcha" data-sitekey="zzz"></div>
<script src="https://js.hcaptcha.com/1/api.js"></script></body></html>`;

const RATELIMIT = `<html><body><h1>429</h1><p>Rate limit exceeded. Too many requests
from your IP. Try again later.</p></body></html>`;

const CLEAN_ARTICLE = `<html><body><article><h1>Surface code</h1>
<p>The surface code is a topological quantum error correcting code defined
on a two-dimensional lattice. Decoding uses minimum weight perfect matching
with a threshold around 11%.</p></article></body></html>`;

const CAPTCHA_MENTION = `<html><body><article><h1>Web security notes</h1>
<p>Some sites show a captcha to block bots. This article explains how the
surface code paper was downloaded without any interference.</p></article>
</body></html>`;

// Security-blog prose: TWO weak words (captcha, blocked), zero challenge DOM.
const BLOG_TWO_WEAK = `<html><body><article><h1>Bot defenses</h1>
<p>Many sites show a captcha to keep spam down. Getting blocked is annoying
for legitimate users, so operators tune thresholds carefully.</p></article>
</body></html>`;

// Same prose plus a login form: structural signal present → must flag.
const BLOG_TWO_WEAK_WITH_FORM = `<html><body><article><h1>Bot defenses</h1>
<p>Many sites show a captcha to keep spam down. Getting blocked is annoying
for legitimate users.</p><form action="/login"><input type="text"></form>
</article></body></html>`;

// THREE weak words, no structure: documented recall-over-precision tradeoff.
const BLOG_THREE_WEAK = `<html><body><article><h1>Bot defenses</h1>
<p>Many sites show a captcha to keep spam down. Getting blocked is annoying,
and access stays forbidden after too many tries.</p></article></body></html>`;

// ── Cases ────────────────────────────────────────────────────────────────

check("cloudflare flags", detectGuard(CLOUDFLARE).guarded === true);
check(
  "cloudflare kind",
  detectGuard(CLOUDFLARE).kind === "cloudflare",
  JSON.stringify(detectGuard(CLOUDFLARE))
);
check("turnstile kind", detectGuard(TURNSTILE).kind === "turnstile");
check("recaptcha kind", detectGuard(RECAPTCHA).kind === "recaptcha");
check("hcaptcha kind", detectGuard(HCAPTCHA).kind === "hcaptcha");
check("rate-limit kind", detectGuard(RATELIMIT).kind === "rate-limit");
check("clean article stays clean", detectGuard(CLEAN_ARTICLE).guarded === false);
check(
  "single captcha mention stays clean",
  detectGuard(CAPTCHA_MENTION).guarded === false,
  JSON.stringify(detectGuard(CAPTCHA_MENTION))
);
check(
  "two weak words without challenge DOM stay clean",
  detectGuard(BLOG_TWO_WEAK).guarded === false,
  JSON.stringify(detectGuard(BLOG_TWO_WEAK))
);
check(
  "two weak words with form flag",
  detectGuard(BLOG_TWO_WEAK_WITH_FORM).guarded === true &&
    detectGuard(BLOG_TWO_WEAK_WITH_FORM).kind === "bot-wall"
);
check(
  "three weak words flag (documented tradeoff)",
  detectGuard(BLOG_THREE_WEAK).guarded === true
);
check(
  "trailer format",
  guardTrailer("example.com", "cloudflare") ===
    "\n\n<!-- guard: cloudflare host=example.com -->"
);

// ── Quarantine allowlist ─────────────────────────────────────────────────

check("quarantine refuses /", quarantineProfileDir("/") === null);
check("quarantine refuses /etc", quarantineProfileDir("/etc") === null);
check("quarantine refuses /data itself", quarantineProfileDir("/data") === null);

const tmpVictim = path.join(os.tmpdir(), `quarantine-test-${Date.now()}`);
fs.mkdirSync(tmpVictim, { recursive: true });
fs.writeFileSync(path.join(tmpVictim, "x"), "x");
const backup = quarantineProfileDir(tmpVictim);
check(
  "quarantine moves tmp dir aside and recreates empty",
  backup !== null &&
    backup !== tmpVictim &&
    fs.existsSync(tmpVictim) &&
    fs.readdirSync(tmpVictim).length === 0 &&
    backup !== null &&
    fs.existsSync(backup),
  `backup=${backup}`
);
if (backup !== null) fs.rmSync(backup, { recursive: true, force: true });
fs.rmSync(tmpVictim, { recursive: true, force: true });

// ── Cache eviction primitives ────────────────────────────────────────────

const tiny = new TtlCache<string, number>(60_000);
tiny.set("a", 1);
tiny.set("b", 2);
tiny.set("c", 3);
check("cache size counts live entries", tiny.size === 3);
tiny.deleteOldest();
check(
  "deleteOldest evicts first-inserted",
  tiny.size === 2 && tiny.get("a") === undefined && tiny.get("c") === 3
);

guardVerdictCache.clear();
cacheGuardVerdict("example.com", { guarded: true, kind: "cloudflare", signals: ["t"] });
check(
  "cacheGuardVerdict stores retrievable verdict",
  guardVerdictCache.get("example.com")?.kind === "cloudflare"
);
guardVerdictCache.clear();

if (failures > 0) {
  console.error(`${failures} guard-detector test(s) FAILED`);
  process.exit(1);
}
console.log("All guard-detector tests passed.");
