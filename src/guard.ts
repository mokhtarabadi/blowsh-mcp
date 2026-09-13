/**
 * Bot-wall / guard detection for rendered page content.
 *
 * Advisory-only: never changes routing or throws. `detectGuard` scans the
 * served content for bot-wall markers (Cloudflare challenge/Turnstile,
 * reCAPTCHA, hCaptcha, DataDome, PerimeterX, GeeTest, Kasada, rate-limit
 * and access-denied pages). Strong DOM markers (challenge scripts, widget
 * containers) flag immediately; weak prose words need >= 2 distinct hits
 * plus DOM structure (or >= 3 hits alone) so articles merely *mentioning*
 * captchas stay clean.
 *
 * Per-host verdicts are cached for 1h (`GUARD_CACHE_TTL_MS`) so repeat
 * fetches against a guarded host stay cheap. Every fetch emits one JSON
 * log line via `logGuardFetch` (host, guard_type, elapsed_ms).
 */
import { TtlCache } from "./cache.js";

export type GuardKind =
  | "cloudflare"
  | "turnstile"
  | "recaptcha"
  | "hcaptcha"
  | "datadome"
  | "perimeterx"
  | "geetest"
  | "kasada"
  | "rate-limit"
  | "access-denied"
  | "bot-wall";

export interface GuardVerdict {
  guarded: boolean;
  kind: GuardKind | null;
  signals: string[];
}

/** Strong markers: a single hit flags the page. [marker, kind]. */
const STRONG_MARKERS: Array<[string, GuardKind]> = [
  ["challenge-platform", "cloudflare"],
  ["__cf_chl", "cloudflare"],
  ["cf-challenge", "cloudflare"],
  ["challenges.cloudflare.com/turnstile", "turnstile"],
  ["cf-turnstile", "turnstile"],
  ["just a moment...", "cloudflare"],
  ["checking your browser before you access", "cloudflare"],
  ["attention required! | cloudflare", "cloudflare"],
  ["google.com/recaptcha", "recaptcha"],
  ["g-recaptcha", "recaptcha"],
  ["recaptcha/api.js", "recaptcha"],
  ["hcaptcha.com", "hcaptcha"],
  ["h-captcha", "hcaptcha"],
  ["datadome", "datadome"],
  ["captcha-delivery", "datadome"],
  ["perimeterx", "perimeterx"],
  ["px-captcha", "perimeterx"],
  ["geetest", "geetest"],
  ["kasada", "kasada"],
  ["x-kasada", "kasada"],
  ["rate limit exceeded", "rate-limit"],
  ["too many requests", "rate-limit"],
  ["unusual traffic", "access-denied"],
  ["pardon our interruption", "access-denied"],
  ["request blocked", "access-denied"],
  ["access denied", "access-denied"],
  ["ip has been blocked", "access-denied"],
];

/**
 * Weak prose words: only flag when EITHER >= 3 DISTINCT words match OR
 * >= 2 match alongside a structural challenge signal (form/iframe/
 * password-field/sitekey). A security blog post mentioning "captcha" and
 * "blocked" in prose stays clean; a real challenge page carries DOM
 * structure that prose does not. The 3-word path is a documented
 * recall-over-precision tradeoff for heavily-redacted block pages.
 */
const WEAK_WORDS = [
  "captcha",
  "verify you are human",
  "are you a robot",
  "prove you're not a robot",
  "blocked",
  "forbidden",
  "enable javascript and cookies",
];

/**
 * Structural challenge signals: DOM artifacts real bot-walls render but
 * prose articles never contain. Lowercased substring match.
 */
const STRUCTURAL_SIGNALS = [
  "<form",
  "<iframe",
  'type="password"',
  "data-sitekey",
];

const WEAK_THRESHOLD = 2;
const WEAK_THRESHOLD_NO_STRUCTURE = 3;

/** Max cached host verdicts — oldest evicted first (unbounded hosts). */
const MAX_GUARD_CACHE_ENTRIES = 1000;

/** Per-host guard verdict cache — 1h TTL. */
export const guardVerdictCache = new TtlCache<string, GuardVerdict>(
  Number(process.env.GUARD_CACHE_TTL_MS) || 3_600_000
);

export function detectGuard(content: string): GuardVerdict {
  const lower = content.toLowerCase();
  const signals: string[] = [];

  for (const [marker, kind] of STRONG_MARKERS) {
    if (lower.includes(marker)) {
      signals.push(marker);
      return { guarded: true, kind, signals };
    }
  }

  const weakHits = WEAK_WORDS.filter((w) => lower.includes(w));
  if (
    weakHits.length >= WEAK_THRESHOLD_NO_STRUCTURE ||
    (weakHits.length >= WEAK_THRESHOLD &&
      STRUCTURAL_SIGNALS.some((s) => lower.includes(s)))
  ) {
    return { guarded: true, kind: "bot-wall", signals: weakHits };
  }
  return { guarded: false, kind: null, signals: weakHits };
}

/**
 * Bounded cache insert: evict oldest first past MAX entries so a broad
 * crawl can never grow the verdict map without limit.
 */
export function cacheGuardVerdict(host: string, v: GuardVerdict): void {
  while (guardVerdictCache.size >= MAX_GUARD_CACHE_ENTRIES) {
    guardVerdictCache.deleteOldest();
  }
  guardVerdictCache.set(host, v);
}

/** One JSON log line per fetch — the A4 observability contract. */
export function logGuardFetch(
  host: string,
  verdict: GuardVerdict,
  elapsedMs: number
): void {
  console.error(
    JSON.stringify({
      event: "fetch",
      host,
      guard_type: verdict.guarded ? verdict.kind : null,
      elapsed_ms: Math.round(elapsedMs),
    })
  );
}

/**
 * Machine-readable trailer appended ONLY when a guard is detected.
 * HTML comment = invisible in rendered Markdown, backwards compatible.
 */
export function guardTrailer(host: string, kind: GuardKind): string {
  return `\n\n<!-- guard: ${kind} host=${host} -->`;
}
