/**
 * Browser crash-circuit and load-shedding regression tests.
 * Run with: npx tsx tests/browser-crash-circuit-tests.ts
 *
 * Scope: no live network, no Browsh, no Firefox. These prove the policy that
 * stops a Browsh Go panic from turning into a CPU-pinning respawn storm and a
 * render queue that never drains:
 *
 *  1. CrashCircuit is pure and timer-free. Three crashes in a window open the
 *     circuit; the cooldown closes it automatically; a stale burst expires.
 *  2. The manager exposes render-slot pressure so optional work (enrichment)
 *     can shed itself instead of inflating the queue it is stuck behind.
 *
 * The external Browsh binary cannot be patched from here, so the guarantee is
 * about containment of its crash, not about the Go segfault itself.
 */

import {
  CrashCircuit,
  DEFAULT_CRASH_COOLDOWN_MS,
  DEFAULT_CRASH_THRESHOLD,
  DEFAULT_CRASH_WINDOW_MS,
  browshManager,
  isSafeProfilePathForKillPath,
  resolveOrphanLockPaths,
  checkPkillAvailable,
  checkMatchingProcess,
  shouldDeleteOrphanLocks,
} from "../src/browshManager.js";
import * as os from "node:os";
import * as path from "node:path";
import { browserQueueLoaded, isQueueLoaded } from "../src/tools/searchWeb.js";
import { createDeadlineError, isDeadlineHitError } from "../src/errors.js";

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

function testCircuit(): void {
  console.log("\n[CrashCircuit — bounded storm containment]");

  // A. The defaults are the documented, bounded values.
  check("window is 60s", DEFAULT_CRASH_WINDOW_MS === 60_000);
  check("threshold is 3", DEFAULT_CRASH_THRESHOLD === 3);
  check("cooldown is 30s", DEFAULT_CRASH_COOLDOWN_MS === 30_000);

  // B. Fewer than three crashes never open the circuit.
  {
    const c = new CrashCircuit();
    check("fresh circuit is closed", !c.isOpen(0));
    check("first crash does not open", c.record(1_000) === false);
    check("second crash does not open", c.record(2_000) === false);
    check("burst count is tracked", c.crashCount === 2);
    check("still closed below threshold", !c.isOpen(2_000));
  }

  // C. The third crash in the window opens it for exactly the cooldown.
  {
    const c = new CrashCircuit();
    c.record(1_000);
    c.record(2_000);
    check("third crash opens the circuit", c.record(3_000) === true);
    check("circuit reports open", c.isOpen(3_000));
    check("remaining time is the cooldown", c.remainingMs(3_000) === DEFAULT_CRASH_COOLDOWN_MS);
    check("burst history clears on open", c.crashCount === 0);
    check("still open just before cooldown ends", c.isOpen(3_000 + DEFAULT_CRASH_COOLDOWN_MS - 1));
    check("closed when cooldown elapses", !c.isOpen(3_000 + DEFAULT_CRASH_COOLDOWN_MS));
    check("remaining time is zero when closed", c.remainingMs(3_000 + DEFAULT_CRASH_COOLDOWN_MS) === 0);
  }

  // D. Crashes outside the window expire and cannot accumulate into a storm.
  {
    const c = new CrashCircuit();
    c.record(0);
    c.record(DEFAULT_CRASH_WINDOW_MS - 1);
    const opened = c.record(DEFAULT_CRASH_WINDOW_MS);
    check("expired burst does not open the circuit", opened === false);
    check("only crashes inside the window are counted", c.crashCount === 2);
  }

  // E. QA hotfix: two crashes spaced beyond the window never open the circuit;
  //    a third arriving inside the window does. This protects the quarantine
  //    decision from firing on crashes scattered across a long uptime.
  {
    const c = new CrashCircuit(1_000, 3, 500);
    check("spaced crash one is harmless", c.record(0) === false);
    check("spaced crash two is harmless", c.record(5_000) === false);
    check("circuit stays closed after spaced crashes", !c.isOpen(5_000));
    check("third crash alone is still below threshold", c.record(5_500) === false);
    check("a fourth crash inside the window opens", c.record(5_600) === true);
  }
}

/**
 * QA hotfix coverage. The pure helpers are used here so the load-shedding and
 * deadline paths are provable without a browser, a network, or a wall clock.
 */
function testLoadSheddingAndDeadline(): void {
  console.log("\n[Load shedding and deadline propagation — no-browser proofs]");

  check("idle queue is not loaded", isQueueLoaded({ busy: false, pending: 0 }) === false);
  check("busy slot is loaded", isQueueLoaded({ busy: true, pending: 0 }) === true);
  check("queued waiter is loaded", isQueueLoaded({ busy: false, pending: 1 }) === true);

  // A fired budget must classify as a deadline hit. The sequential variant
  // loop throws this shape instead of `break`, so the outer race runs the
  // cheap fallback instead of returning a bare empty result.
  const deadline = createDeadlineError("deadline.hit: search timed out after 100ms (query: q)");
  check("thrown abort is classified as a deadline hit", isDeadlineHitError(deadline) === true);
  check("ordinary error is not a deadline hit", isDeadlineHitError(new Error("other")) === false);
}

function testOrphanCleanup(): void {
  console.log("\n[Orphan Firefox cleanup — allowlist and tool-missing safety]");
  // Allowlist refusal: only /data or tmpdir at depth 3 plus passes.
  check("allowlisted data profile passes", isSafeProfilePathForKillPath("/data/browsh-profile") === true);
  const tmpProfile = path.join(os.tmpdir(), "browsh-profile-test");
  check("allowlisted tmp profile passes", isSafeProfilePathForKillPath(tmpProfile) === true);
  check("root refuses", isSafeProfilePathForKillPath("/") === false);
  check("data root itself refuses", isSafeProfilePathForKillPath("/data") === false);
  check("outside bases refuses", isSafeProfilePathForKillPath("/etc/passwd") === false);
  check("tmp root itself refuses", isSafeProfilePathForKillPath(os.tmpdir()) === false);
  // Tool-missing safety via stubbed exec, no real pkill or pgrep runs here.
  const throwEnoent = (): unknown => {
    const e = new Error("spawn ENOENT") as Error & { code: string };
    e.code = "ENOENT";
    throw e;
  };
  const throwNoMatch = (): unknown => {
    const e = new Error("no match") as Error & { status: number };
    (e as unknown as { status: number }).status = 1;
    throw e;
  };
  const returnOk = (): unknown => Buffer.from("");
  const throwTimeout = (): unknown => {
    const e = new Error("timeout") as Error & { code: string };
    e.code = "ETIMEDOUT";
    (e as unknown as { status: null }).status = null;
    throw e;
  };
  check("pkill missing returns false", checkPkillAvailable(throwEnoent) === false);
  check("pkill present returns true even on no match", checkPkillAvailable(throwNoMatch) === true);
  check("pgrep missing returns null", checkMatchingProcess("/data/browsh-profile", throwEnoent) === null);
  check("pgrep no match returns false", checkMatchingProcess("/data/browsh-profile", throwNoMatch) === false);
  check("pgrep match returns true", checkMatchingProcess("/data/browsh-profile", returnOk) === true);
  check("pgrep timeout returns null", checkMatchingProcess("/data/browsh-profile", throwTimeout) === null);
  check("prefix trick refuses", isSafeProfilePathForKillPath("/data-evil") === false);
  check("relative outside refuses", isSafeProfilePathForKillPath("data/browsh-profile") === false);
  // Lock deletion gated only on confirmed no process plus pkill present.
  check("deletes only when no process and pkill present", shouldDeleteOrphanLocks(false, true) === true);
  check("skips when process still alive", shouldDeleteOrphanLocks(true, true) === false);
  check("skips when pgrep missing", shouldDeleteOrphanLocks(null, true) === false);
  check("skips when pkill missing", shouldDeleteOrphanLocks(false, false) === false);
  // Resolver wiring.
  const locks = resolveOrphanLockPaths("/data/browsh-profile");
  check("resolves three lock paths", locks.length === 3);
  check("first lock is profile parentlock", locks[0] === path.join("/data/browsh-profile", ".parentlock"));
}

async function main(): Promise<void> {
  testCircuit();
  testLoadSheddingAndDeadline();
  testOrphanCleanup();

  console.log("\n[Render-slot pressure — load shedding]");
  const pressure = browshManager.queuePressure;
  check("queue pressure is exposed", typeof pressure.busy === "boolean" && typeof pressure.pending === "number");
  check("idle manager reports no load", browserQueueLoaded() === false);

  console.log("");
  if (failures > 0) {
    console.log(`${failures} of ${checks} check(s) FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log(`all ${checks} checks passed`);
}

await main();
