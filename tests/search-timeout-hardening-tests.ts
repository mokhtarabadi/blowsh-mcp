/**
 * Search timeout hardening regression tests.
 * Run with: npx tsx tests/search-timeout-hardening-tests.ts
 *
 * Scope: no live network, no Browsh, no Firefox. These cover the two failure
 * modes that made parallel multi-step searches fail and time out:
 *
 *  1. The render mutex serialized every engine, and a queued render had no
 *     bound at all — the caller saw a hang, not an error. RenderQueue proves
 *     the wait is bounded by the queue budget and by the caller's AbortSignal,
 *     and that an aborted waiter never deadlocks the next one.
 *  2. `search_web` had no outer deadline unless the caller passed one, and
 *     dead tiers (Google/Startpage, usually robot-blocked) cost a render on
 *     every search. The budget resolver and the blocked-engine breaker are
 *     proved here, including the safety property that the breaker may never
 *     skip the last untried engine.
 *
 *  3. The four budgets form one ladder: a render timeout, a queue wait, a
 *     search deadline, and an enrichment budget. The ladder is asserted as an
 *     invariant (search >= queue + render) rather than as four magic numbers,
 *     so a future edit that raises one knob alone fails here instead of
 *     silently producing false timeouts.
 */

import fs from "node:fs";
import {
  BROWSH_STARTUP_TIMEOUT_MESSAGE,
  DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
  DEFAULT_QUEUE_TIMEOUT_MS,
  DEFAULT_RENDER_TIMEOUT_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  RenderQueue,
  isStartupProbeTimeout,
  resolveRenderTimeouts,
} from "../src/browshManager.js";
import { FetchError } from "../src/errors.js";
import {
  ENRICH_BUDGET_MS,
  MAX_SEARCH_DEADLINE_MS,
  isBreakerArmed,
  isEngineSkipped,
  markEngineBlocked,
  resetBlockedEngines,
  resolveSearchDeadline,
} from "../src/tools/searchWeb.js";

let failures = 0;
let checks = 0;

function check(name: string, passed: boolean, detail = ""): void {
  checks++;
  if (passed) {
    console.log(`${name}: PASS`);
  } else {
    failures++;
    console.log(`${name}: FAIL${detail ? ` — ${detail}` : ""}`);
  }
}

/** Lets queued microtasks settle without waiting on a wall clock. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function testRenderQueue(): Promise<void> {
  console.log("\n[RenderQueue — bounded and abortable wait]");

  // A. The free slot is granted immediately.
  {
    const q = new RenderQueue(5_000);
    const out = await q.acquire();
    check("free slot is granted immediately", out.granted === true && q.isBusy);
    q.release();
    check("slot frees after release", q.isBusy === false && q.pending === 0);
  }

  // B. A second waiter queues FIFO and is granted on release.
  {
    const q = new RenderQueue(5_000);
    await q.acquire();
    const second = q.acquire();
    await tick();
    check("second waiter is queued while the slot is busy", q.pending === 1);
    q.release();
    const out = await second;
    check("queued waiter is granted on release", out.granted === true);
    check("slot stays busy across the hand-off", q.isBusy === true);
    q.release();
    check("slot frees once the last waiter releases", q.isBusy === false && q.pending === 0);
  }

  // C. Aborting a queued waiter hands the slot to the next LIVE waiter.
  //    This is the no-deadlock property: release() must skip a waiter that
  //    already gave up instead of handing the slot to an already-settled
  //    promise, which would leave the slot busy forever.
  {
    const q = new RenderQueue(60_000);
    await q.acquire();
    const dead = new AbortController();
    const live = new AbortController();
    const deadWait = q.acquire(dead.signal);
    const liveWait = q.acquire(live.signal);
    await tick();
    check("two waiters queue behind a busy slot", q.pending === 2);

    dead.abort();
    const deadOut = await deadWait;
    check(
      "aborted waiter reports aborted, not granted",
      deadOut.granted === false && deadOut.reason === "aborted",
      JSON.stringify(deadOut)
    );

    q.release();
    const liveOut = await liveWait;
    check(
      "aborted waiter is skipped and the live waiter gets the slot",
      liveOut.granted === true,
      JSON.stringify(liveOut)
    );
    check("aborted waiter leaves no residue in the queue", q.pending === 0);

    q.release();
    check("no deadlock: slot frees after the aborted waiter is skipped", q.isBusy === false);
  }

  // D. The queue budget expires instead of waiting forever.
  {
    const q = new RenderQueue(20);
    await q.acquire();
    const out = await q.acquire();
    check(
      "queue budget expiry reports queue-timeout, not granted",
      out.granted === false && out.reason === "queue-timeout",
      JSON.stringify(out)
    );
    q.release();
    check("slot frees after a queue-timeout waiter", q.isBusy === false);
  }

  // E. An already-aborted signal never takes the slot.
  {
    const q = new RenderQueue(5_000);
    const c = new AbortController();
    c.abort();
    const out = await q.acquire(c.signal);
    check(
      "already-aborted signal does not take the slot",
      out.granted === false && out.reason === "aborted" && q.isBusy === false,
      JSON.stringify(out)
    );
  }
}

function testBudget(): void {
  console.log("\n[search_web — default budget]");

  if (process.env.SEARCH_DEADLINE_MS) {
    console.log(
      `[search-timeout-hardening] SEARCH_DEADLINE_MS is set (${process.env.SEARCH_DEADLINE_MS}); ` +
        "the literal-default assertion is skipped."
    );
  } else {
    check(
      "default budget is 900000 when SEARCH_DEADLINE_MS is unset",
      resolveSearchDeadline(undefined) === 900_000
    );
  }

  check("explicit budget wins over the default", resolveSearchDeadline(12_345) === 12_345);
  check("zero budget falls back to the default", resolveSearchDeadline(0) === resolveSearchDeadline(undefined));
  check("negative budget falls back to the default", resolveSearchDeadline(-5) === resolveSearchDeadline(undefined));
  check("budget clamps up to the 500ms floor", resolveSearchDeadline(10) === 500);
  check("budget clamps down to the 1800000ms ceiling", resolveSearchDeadline(99_999_999) === 1_800_000);
  check("ceiling constant is 1800000", MAX_SEARCH_DEADLINE_MS === 1_800_000);
  // A malformed env value must fall back, never become NaN. NaN propagates
  // through Math.min/Math.max and makes setTimeout(fn, NaN) fire in ~1 ms,
  // which would abort every search instantly.
  check("NaN budget falls back instead of propagating", Number.isFinite(resolveSearchDeadline(Number("abc"))));
  check(
    "malformed env budget resolves to a sane default",
    (() => {
      const v = resolveSearchDeadline(Number("abc"));
      return Number.isFinite(v) && v === resolveSearchDeadline(undefined);
    })()
  );
  check(
    "default budget stays inside the allowed band",
    (() => {
      const d = resolveSearchDeadline(undefined);
      return d >= 500 && d <= MAX_SEARCH_DEADLINE_MS;
    })()
  );
}

function testBreaker(): void {
  console.log("\n[search_web — blocked-engine breaker]");

  resetBlockedEngines();
  check("unblocked engine is never skipped", isEngineSkipped("google", true) === false);
  check("breaker is armed when nothing is remembered", isBreakerArmed(["google"]) === true);

  markEngineBlocked("google");
  check("blocked engine is skipped while armed", isEngineSkipped("google", true) === true);
  check("other engines are still tried", isEngineSkipped("brave", true) === false);
  check(
    "breaker stays armed while another candidate is live",
    isBreakerArmed(["google", "brave"]) === true
  );

  markEngineBlocked("brave");
  check(
    "with every candidate blocked the breaker is disarmed",
    isBreakerArmed(["google", "brave"]) === false
  );
  check(
    "disarmed breaker never skips, so the search is never emptied",
    isEngineSkipped("google", isBreakerArmed(["google", "brave"])) === false
  );

  resetBlockedEngines();
  check("reset clears the breaker", isEngineSkipped("google", true) === false);
  check("reset re-arms the breaker", isBreakerArmed(["google"]) === true);
}

function testLadder(): void {
  console.log("\n[timeout ladder — the budgets must agree]");

  const render = DEFAULT_RENDER_TIMEOUT_MS;
  const queue = DEFAULT_QUEUE_TIMEOUT_MS;
  const search = resolveSearchDeadline(undefined);

  // The invariant: a queued render must be able to finish inside the search
  // budget. queue is the longest a render may wait for the slot, and render is
  // how long it then needs — a search budget below their sum aborts renders
  // that were still legitimately queued, which is the failure this ladder
  // exists to prevent.
  check(
    `search budget (${search}) covers queue + render (${queue + render})`,
    search >= queue + render,
    `${search} < ${queue + render}`
  );

  // The queue budget must fund at least two renders: the worst single-query
  // chain queues a render behind another one.
  check(
    `queue budget (${queue}) funds two renders (${render * 2})`,
    queue >= render * 2,
    `${queue} < ${render * 2}`
  );

  // Each render must be allowed at least one render's worth of enrichment.
  check(
    `enrich budget (${ENRICH_BUDGET_MS}) funds one render (${render})`,
    ENRICH_BUDGET_MS >= render,
    `${ENRICH_BUDGET_MS} < ${render}`
  );

  // Every budget must sit inside its own accepted range.
  check("render timeout is positive", render > 0);
  check("startup budget funds the measured ~31s cold start", DEFAULT_STARTUP_TIMEOUT_MS >= 31_000);
  check("search budget is inside the deadline band", search >= 500 && search <= MAX_SEARCH_DEADLINE_MS);
  // The health probe must outlast a real render of Browsh's welcome page
  // (measured ~0.9-2 s here). The old hardcoded 800 ms made startup fail even
  // though the endpoint was answering 200.
  check(
    `health probe default (${DEFAULT_HEALTH_PROBE_TIMEOUT_MS}ms) outlasts a slow control page`,
    DEFAULT_HEALTH_PROBE_TIMEOUT_MS >= 5_000
  );
  const probeLive = resolveRenderTimeouts({ BROWSH_HEALTH_PROBE_TIMEOUT_MS: "9000" } as NodeJS.ProcessEnv);
  check("health probe timeout is configurable", probeLive.probe === 9_000, `got ${probeLive.probe}`);
  // clampIntEnv rejects an out-of-band value and uses the safe default; it
  // does not snap to the band edge. Assert that contract, not a clamp.
  const probeOutOfBand = resolveRenderTimeouts({ BROWSH_HEALTH_PROBE_TIMEOUT_MS: "100" } as NodeJS.ProcessEnv);
  check("out-of-band health probe falls back to the safe default", probeOutOfBand.probe === DEFAULT_HEALTH_PROBE_TIMEOUT_MS, `got ${probeOutOfBand.probe}`);

  // N3 (QA follow-up): the four checks above read the DEFAULT constants, so a
  // bad env combination that clamps each knob into its own band but breaks the
  // ladder would pass. Assert on the values that actually run instead.
  const live = resolveRenderTimeouts(process.env);
  const liveSearch = resolveSearchDeadline(process.env.SEARCH_DEADLINE_MS ? Number(process.env.SEARCH_DEADLINE_MS) : undefined);
  check(
    `env-resolved ladder holds: search (${liveSearch}) covers queue + render (${live.queue + live.render})`,
    liveSearch >= live.queue + live.render,
    `env BROWSH_QUEUE_TIMEOUT_MS/BROWSH_REQUEST_TIMEOUT_MS/SEARCH_DEADLINE_MS break the ladder`
  );
  check(
    `env-resolved queue (${live.queue}) funds two renders (${live.render * 2})`,
    live.queue >= live.render * 2,
    "env BROWSH_QUEUE_TIMEOUT_MS < 2 x BROWSH_REQUEST_TIMEOUT_MS"
  );

  // A deliberately bad combination must be caught, not silently clamped into
  // something that looks fine per-knob.
  const bad = resolveRenderTimeouts({
    BROWSH_REQUEST_TIMEOUT_MS: "180000",
    BROWSH_QUEUE_TIMEOUT_MS: "200000",
  } as NodeJS.ProcessEnv);
  check(
    `a per-knob-valid but ladder-breaking env is detectable (${bad.queue} < ${bad.render * 2})`,
    bad.queue < bad.render * 2,
    "expected the bad combination to violate queue >= 2 x render"
  );
}

function testStartupProbeGuard(): void {
  const exact = new FetchError(BROWSH_STARTUP_TIMEOUT_MESSAGE);
  check("probe guard matches exact startup timeout", isStartupProbeTimeout(exact) === true);
  const suffixed = new FetchError(`${BROWSH_STARTUP_TIMEOUT_MESSAGE} [http 500]`);
  check("probe guard matches suffixed message", isStartupProbeTimeout(suffixed) === true);
  const other = new FetchError("mkdir blocked by file");
  check("probe guard rejects other boot error", isStartupProbeTimeout(other) === false);
  const generic = new Error(BROWSH_STARTUP_TIMEOUT_MESSAGE);
  check("probe guard rejects non FetchError", isStartupProbeTimeout(generic) === false);
  const src = fs.readFileSync("src/browshManager.ts", "utf8");
  check("waitForReady uses configured probe timeout", src.includes("timeout: this.healthProbeTimeoutMs"));
  check("hardcoded 800ms probe is gone", !src.includes("timeout: 800"));
  const budgets = resolveRenderTimeouts({} as NodeJS.ProcessEnv);
  check("probe stays below startup budget", budgets.probe < budgets.startup, `probe ${budgets.probe} startup ${budgets.startup}`);
}

async function main(): Promise<void> {
  await testRenderQueue();
  testBudget();
  testLadder();
  testStartupProbeGuard();
  testBreaker();

  console.log("");
  if (failures > 0) {
    console.log(`${failures} of ${checks} check(s) FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log(`all ${checks} checks passed`);
}

await main();
