// Sibling Docs: src/README.md | Decisions: src/DECISIONS.md
import { spawn, ChildProcess } from "child_process";
import axios from "axios";
import { FetchError } from "./errors.js";
import { pageCache } from "./cache.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureFirefoxProxyPrefs, resolveProxyConfig } from "./proxyConfig.js";

/**
 * Strips terminal-style layout whitespace from Browsh plain text output.
 *
 * 1. Removes leading/trailing blank (whitespace-only) lines.
 * 2. Collapses runs of consecutive blank lines to a single newline.
 * 3. Detects the minimum indentation across all content lines and strips
 *    that consistent prefix, removing Browsh's terminal padding while
 *    preserving relative indentation (e.g. code blocks, nested lists).
 * 4. Trims trailing spaces from each line.
 */
/**
 * Parse an integer env var with range clamp. Unset/non-numeric → silent
 * fallback; out-of-range → fallback with a loud warning (a typo like
 * BROWSH_COLS=1600 must never silently spawn a degenerate terminal).
 */
function clampIntEnv(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
  label: string
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) {
    console.error(
      `[browshManager] ${label}=${raw} out of range [${min},${max}], using ${fallback}`
    );
    return fallback;
  }
  return n;
}

function cleanPlainText(text: string): string {
  // Step 1–2: remove blank lines and collapse runs
  const cleaned = text
    .replace(/^(\s*\n)+/, "")
    .replace(/(\n\s*)+$/, "")
    .replace(/\n{2,}/g, "\n");

  const lines = cleaned.split("\n").map((l) => l.trimEnd());

  // Step 3: find minimum leading spaces across non-empty lines
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const match = line.match(/^(\s*)/);
    if (match && match[1].length < minIndent) {
      minIndent = match[1].length;
    }
  }

  // Step 4: strip the common prefix and trim trailing spaces
  if (minIndent > 0 && minIndent < Infinity) {
    return lines
      .map((line) => (line.trim() === "" ? "" : line.slice(minIndent)))
      .join("\n");
  }
  return lines.join("\n");
}

/**
 * Default budgets for the render path (ms). Exported so the ladder can be
 * asserted in one place: these three plus `SEARCH_DEADLINE_MS` must satisfy
 * `searchDeadline >= queueWait + render`, or a render can be aborted while it
 * was still legitimately queued.
 */
export const DEFAULT_RENDER_TIMEOUT_MS = 180_000;
export const DEFAULT_QUEUE_TIMEOUT_MS = 600_000;
export const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
/**
 * Per-probe budget for the Browsh control-channel health check.
 *
 * Browsh's `/` endpoint renders its welcome page on every request; measured
 * latency on a busy host is 0.9-2 s, and a proxy adds more. The old hardcoded
 * 800 ms probe therefore always timed out and the manager reported a false
 * "Browsh did not start in HTTP mode within timeout" even though the endpoint
 * was answering HTTP 200. Five seconds absorbs normal render latency while a
 * genuinely absent endpoint still fails quickly inside the startup budget.
 */
export const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5_000;

/**
 * Shared message for the startup health-probe timeout. The quarantine guard
 * matches against this constant so a later wording or status-suffix change
 * cannot silently restore profile quarantine on a slow-but-healthy browser.
 */
export const BROWSH_STARTUP_TIMEOUT_MESSAGE = "Browsh did not start in HTTP mode within timeout";

/**
 * True only when the error is the startup health-probe timeout.
 *
 * A pure probe timeout means the control page was slow, not that the Firefox
 * profile is corrupt, so `ensureStarted` must skip quarantine for it. The
 * substring match keeps a `FetchError` with an `[http <status>]` suffix
 * recognised; a non-FetchError or any other boot error returns false and
 * leaves the quarantine path intact for genuine path and lock failures.
 */
export function isStartupProbeTimeout(e: unknown): boolean {
  if (!(e instanceof FetchError)) return false;
  const msg: unknown = (e as Error).message;
  return typeof msg === "string" && msg.includes(BROWSH_STARTUP_TIMEOUT_MESSAGE);
}

/**
 * Resolve the render-path budgets the same way the constructor does, so a test
 * can assert the ladder invariant on the values that actually run — not just on
 * the defaults. An env combination that clamps each knob into its own band but
 * breaks `search >= queue + render` must fail the assertion.
 */
export function resolveRenderTimeouts(env: NodeJS.ProcessEnv = process.env): {
  render: number;
  queue: number;
  startup: number;
  probe: number;
} {
  return {
    render: clampIntEnv(env.BROWSH_REQUEST_TIMEOUT_MS, 10_000, 600_000, DEFAULT_RENDER_TIMEOUT_MS, "BROWSH_REQUEST_TIMEOUT_MS"),
    queue: clampIntEnv(env.BROWSH_QUEUE_TIMEOUT_MS, 10_000, 1_200_000, DEFAULT_QUEUE_TIMEOUT_MS, "BROWSH_QUEUE_TIMEOUT_MS"),
    startup: clampIntEnv(env.BROWSH_STARTUP_TIMEOUT_MS, 10_000, 600_000, DEFAULT_STARTUP_TIMEOUT_MS, "BROWSH_STARTUP_TIMEOUT_MS"),
    probe: clampIntEnv(env.BROWSH_HEALTH_PROBE_TIMEOUT_MS, 1_000, 60_000, DEFAULT_HEALTH_PROBE_TIMEOUT_MS, "BROWSH_HEALTH_PROBE_TIMEOUT_MS"),
  };
}

/**
 * Defaults for the browser crash circuit-breaker.
 *
 * A Browsh 1.8.0 child can die from a Go interfacer panic when Firefox starts
 * or quits during a race. Without a breaker each crash triggers an immediate
 * respawn, and a crash storm burns CPU while every queued render waits for a
 * browser that keeps dying. Three crashes in a minute is not a transient
 * hiccup; it is a storm, and the circuit stops paying for it.
 */
export const DEFAULT_CRASH_WINDOW_MS = 60_000;
export const DEFAULT_CRASH_THRESHOLD = 3;
export const DEFAULT_CRASH_COOLDOWN_MS = 30_000;

/**
 * Pure, timer-free crash circuit. Exported so the storm policy is provable
 * without a browser or a wall clock. `now` is always supplied by the caller.
 *
 * Once `threshold` crashes land inside `windowMs`, the circuit opens for
 * `cooldownMs` and the burst history clears. When the cooldown elapses the
 * circuit closes with an empty history, so recovery is automatic and bounded.
 */
export class CrashCircuit {
  private crashes: number[] = [];
  private openUntil = 0;

  constructor(
    private readonly windowMs: number = DEFAULT_CRASH_WINDOW_MS,
    private readonly threshold: number = DEFAULT_CRASH_THRESHOLD,
    private readonly cooldownMs: number = DEFAULT_CRASH_COOLDOWN_MS
  ) {}

  /** Record a crash at `now`. Returns true when this crash opened the circuit. */
  record(now: number): boolean {
    this.crashes = this.crashes.filter((t) => now - t < this.windowMs);
    this.crashes.push(now);
    if (this.crashes.length >= this.threshold) {
      this.openUntil = now + this.cooldownMs;
      this.crashes = [];
      return true;
    }
    return false;
  }

  /** True while new work must be rejected to let the browser settle. */
  isOpen(now: number): boolean {
    return now < this.openUntil;
  }

  /** Milliseconds until the circuit closes (0 when already closed). */
  remainingMs(now: number): number {
    return Math.max(0, this.openUntil - now);
  }

  /** Crashes recorded in the current, still-open burst window. */
  get crashCount(): number {
    return this.crashes.length;
  }

  /**
   * Forget all history. TEST-SEAM ONLY: the production start path deliberately
   * does not call this while the circuit is open, because clearing `openUntil`
   * would close the circuit early and defeat the cooldown. Recovery is by the
   * cooldown elapsing, not by an explicit reset.
   */
  reset(): void {
    this.crashes = [];
    this.openUntil = 0;
  }
}

/**
 * One render queued behind the browser mutex.
 *
 * `aborted` marks a waiter that gave up while it was still queued (the
 * caller's signal fired, or the queue budget expired). Such a waiter stays in
 * the queue so the FIFO accounting stays intact, but `release()` must skip it:
 * the mutex is handed to a live waiter, never to a dead one.
 */
interface Waiter {
  resolve: (granted: boolean) => void;
  aborted: boolean;
}

/** Outcome of a mutex acquisition attempt. */
interface AcquireOutcome {
  /** True when the mutex was granted and the caller may render. */
  granted: boolean;
  /** Why the wait ended without the mutex (absent when granted). */
  reason?: "aborted" | "queue-timeout";
}

/**
 * FIFO queue guarding the single Browsh render slot.
 *
 * Every render is serialized, so a queued render's wait is bounded two ways:
 * the caller's `AbortSignal` (a fired deadline) and the queue budget. A waiter
 * that gives up stays in the queue marked `aborted`; `release()` skips it, so
 * the slot is always handed to a live waiter and never to a dead one.
 *
 * Exported for tests: the bounded/abortable wait is the contract that keeps a
 * parallel search from hanging, and it is provable without a browser.
 */
export class RenderQueue {
  private busy = false;
  private waiting: Waiter[] = [];

  constructor(private readonly queueTimeoutMs: number) {}

  /** True while a render holds the slot. */
  get isBusy(): boolean {
    return this.busy;
  }

  /** Number of waiters still queued (including ones that gave up). */
  get pending(): number {
    return this.waiting.length;
  }

  /**
   * Acquire the slot. Resolves `granted: true` when the slot is taken, or
   * `granted: false` with a reason when the caller aborted or the queue budget
   * expired — in which case the slot was never taken and nothing must be
   * released by the caller.
   */
  acquire(signal?: AbortSignal): Promise<AcquireOutcome> {
    if (signal?.aborted) {
      return Promise.resolve({ granted: false, reason: "aborted" });
    }
    if (!this.busy) {
      this.busy = true;
      return Promise.resolve({ granted: true });
    }
    return new Promise<AcquireOutcome>((resolve) => {
      const waiter: Waiter = { resolve: () => undefined, aborted: false };
      let settled = false;

      /** Settle the promise exactly once and release the waiter's resources. */
      const settle = (granted: boolean, reason?: AcquireOutcome["reason"]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(reason ? { granted, reason } : { granted });
      };

      /** Give up on the wait: the caller aborted, or the queue budget expired. */
      const giveUp = (reason: AcquireOutcome["reason"], detail: string): void => {
        if (settled) return;
        waiter.aborted = true;
        console.error("[browshManager] queue wait ended early: %s", detail);
        settle(false, reason);
      };

      function onAbort(): void {
        giveUp("aborted", "caller aborted while queued");
      }

      waiter.resolve = (granted: boolean): void => {
        if (granted) {
          waiter.aborted = false;
          settle(true);
        } else {
          settle(false);
        }
      };

      // Deliberately NOT unref()ed: a queued wait must still fire its timeout
      // even if nothing else holds the event loop, or the queue budget becomes
      // a lie in a short-lived process (a queued render would hang instead of
      // failing honestly). The render itself holds the loop while in flight,
      // so keeping this handle referenced costs nothing.
      const timer = setTimeout(
        () => giveUp("queue-timeout", `queue timeout after ${this.queueTimeoutMs}ms`),
        this.queueTimeoutMs
      );

      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  /** Release the slot, handing control to the first live waiter if any. */
  release(): void {
    // Skip waiters that gave up while queued (aborted, or queue timeout): the
    // slot must be handed to a live waiter, never to a dead one.
    while (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      if (next.aborted) continue;
      next.resolve(true);
      return;
    }
    this.busy = false;
  }
}

/**
 * Manages the single Browsh instance lifecycle: lazy start, health probing,
 * request serialization (mutex), request-count-based recycling, and idle kill.
 *
 * Long sessions accumulate tabs in the persistent Firefox process. To bound
 * memory, the manager recycles the process after `BROWSH_RECYCLE_REQUESTS`
 * requests (default 100) and kills it after `BROWSH_IDLE_TIMEOUT_MS` of
 * inactivity (default 10 min). Both operations are fire-and-forget between
 * requests — never mid-request — enforced by the same mutex used for fetches.
 *
 * [browshManager] console.error logs mark acquire/release/recycle/idle events
 * for runtime diagnosis.
 */
class BrowshManager {
  private warmup: Promise<void> | null = null;
  private process: ChildProcess | null = null;
  private readonly firefoxPath: string;
  private readonly healthPath: string = "/";
  private readonly requestTimeoutMs: number;
  private readonly queueTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly healthProbeTimeoutMs: number;
  private readonly recycleThreshold: number;
  private readonly idleTimeoutMs: number;
  private readonly profileDir: string;
  private readonly cols: number;
  private readonly rows: number;

  private requestCount = 0;
  private readonly queue: RenderQueue;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCycleAt = 0;
  /** Unexpected child exits only; intentional recycle/idle teardown never touches this. */
  private readonly crashCircuit: CrashCircuit;
  /** Lifetime count, kept for observability only. Never used for quarantine decisions. */
  private totalCrashes = 0;
  /** Set only when CrashCircuit opens on a true in-window storm; cleared after one quarantine. */
  private stormPending = false;
  /** The configured threshold, so the quarantine decision honours the env knob. */
  private readonly crashThreshold: number;

  constructor(firefoxPath?: string) {
    // Get path from env or default to "firefox"
    this.firefoxPath =
      firefoxPath || process.env.BROWSH_FIREFOX_PATH || "firefox";
    // Per-render timeout. Raised from 30s: a rendered search-engine page
    // routinely takes 10-20s on a cold or busy host, and a 30s cap turned a
    // merely slow page into a failed render. Raised again to 180s for slow
    // hosts behind heavy JS pages. The mutex queue wait is bounded separately
    // (BROWSH_QUEUE_TIMEOUT_MS), so a slow render cannot become an unbounded
    // hang.
    //
    // All three render-path budgets come from one resolver so the values that
    // run are the values a test can assert the ladder invariant on.
    const budgets = resolveRenderTimeouts();
    this.requestTimeoutMs = budgets.render;
    // Queue-wait budget: how long a render may sit behind the mutex before it
    // fails with an honest error. The per-render timeout only starts once the
    // mutex is granted, so without this bound a queued render could wait
    // indefinitely while the caller saw nothing at all.
    //
    // MUST stay >= BROWSH_REQUEST_TIMEOUT_MS * 2: the worst single-query chain
    // queues a render behind another render, and a queue budget smaller than
    // one render can only ever produce false timeouts. The search budget
    // (SEARCH_DEADLINE_MS) must in turn exceed this value plus one render.
    this.queueTimeoutMs = budgets.queue;
    // Cold-start budget for the Browsh HTTP endpoint. Measured 31s on a warm
    // profile in the fat image, so the old hardcoded 30s window killed the
    // browser about one second before it was ready and every first fetch after
    // a container start failed. Raised to 120s for slow hosts. Configurable.
    this.startupTimeoutMs = budgets.startup;
    // Per-probe budget for the health check. The overall startup window above
    // still bounds the loop; this only stops a slow-but-healthy control page
    // from being mistaken for a dead browser.
    this.healthProbeTimeoutMs = budgets.probe;
    this.recycleThreshold = Number(process.env.BROWSH_RECYCLE_REQUESTS) || 100;
    this.idleTimeoutMs = Number(process.env.BROWSH_IDLE_TIMEOUT_MS) || 600_000;
    // Persistent Firefox profile: Browsh 1.8.0 offers no profile-dir flag, so
    // the whole child HOME is redirected — everything Firefox persists
    // (cookies, history, storage) lives under profileDir.
    this.profileDir = process.env.BROWSH_PROFILE_DIR || "/data/browsh-profile";
    // Terminal dims for the Browsh child. Browsh 1.8.0 has no dims flag and
    // http-server-mode renders wide regardless (measured >= 100 cols), but
    // the explicit 160x60 env replaces any 80x24 fallback in the launcher path.
    this.cols = clampIntEnv(process.env.BROWSH_COLS, 80, 250, 160, "BROWSH_COLS");
    this.rows = clampIntEnv(process.env.BROWSH_ROWS, 24, 100, 60, "BROWSH_ROWS");
    this.queue = new RenderQueue(this.queueTimeoutMs);
    this.crashThreshold = clampIntEnv(process.env.BROWSH_CRASH_THRESHOLD, 2, 20, DEFAULT_CRASH_THRESHOLD, "BROWSH_CRASH_THRESHOLD");
    this.crashCircuit = new CrashCircuit(
      clampIntEnv(process.env.BROWSH_CRASH_WINDOW_MS, 5_000, 600_000, DEFAULT_CRASH_WINDOW_MS, "BROWSH_CRASH_WINDOW_MS"),
      this.crashThreshold,
      clampIntEnv(process.env.BROWSH_CRASH_COOLDOWN_MS, 1_000, 300_000, DEFAULT_CRASH_COOLDOWN_MS, "BROWSH_CRASH_COOLDOWN_MS")
    );
  }

  /** Start Browsh if not running. */
  async ensureStarted(): Promise<void> {
    if (this.isRunning) return;
    const now = Date.now();
    // After a true in-window storm the persisted Firefox profile is the prime
    // suspect. Move it aside before another spawn so the next browser gets a
    // clean home. `stormPending` is armed only when CrashCircuit.record opens
    // the circuit, so it honours the configured threshold and never fires for
    // crashes spaced far apart. quarantineProfileDir is allowlisted to /data
    // and TMP, so an operator typo in BROWSH_PROFILE_DIR cannot move host data.
    if (this.stormPending) {
      const backup = quarantineProfileDir(this.profileDir);
      if (backup) {
        console.error(`[browshManager] quarantined profile after crash storm: ${backup}`);
        this.stormPending = false;
        this.totalCrashes = 0;
      }
    }
    // Fail fast while the breaker is open: respawning into a crash loop is
    // what pinned the CPU at 312% and buried every caller in the render queue.
    if (this.crashCircuit.isOpen(now)) {
      throw new FetchError(
        `Browsh circuit open after repeated crashes; retry in ${this.crashCircuit.remainingMs(now)}ms`,
        { url: this.healthPath }
      );
    }
    try {
      fs.mkdirSync(this.profileDir, { recursive: true });
      const entries = fs.readdirSync(this.profileDir).length;
      console.error(
        entries > 0
          ? `[browshManager] reusing profile (${entries} entries): ${this.profileDir}`
          : `[browshManager] fresh profile dir: ${this.profileDir}`
      );
      // Firefox ignores HTTP_PROXY from the environment, so its proxy prefs
      // must live in the redirected profile. Rewrite on every boot so a stale
      // user.js on the /data/browsh-profile volume cannot keep a proxy active.
      ensureFirefoxProxyPrefs(this.profileDir, resolveProxyConfig(process.env));
      await this.spawnAndWait();
    } catch (e) {
      // A pure health-probe timeout means the control page was slow, not that
      // the profile is corrupt. Quarantining here would discard a healthy
      // profile and pay a second full startup budget for no reason. Surface
      // the real error and let the caller decide; quarantine stays reserved
      // for path/lock failures that actually justify a fresh profile.
      if (isStartupProbeTimeout(e)) {
        throw e;
      }
      // Any other boot-path failure (mkdir blocked by a file, stale lock, torn
      // storage): quarantine the path, start fresh, warn loudly. Retry ONLY
      // when quarantine actually moved the path aside; otherwise rethrow
      // (bounded, never loops).
      const backup = quarantineProfileDir(this.profileDir);
      if (backup === null) {
        throw e;
      }
      // The quarantine above renamed the old profile away; seed the fresh
      // directory before the retry so the recycled browser gets the same prefs.
      ensureFirefoxProxyPrefs(this.profileDir, resolveProxyConfig(process.env));
      await this.spawnAndWait();
      if (e instanceof Error) {
        console.error(`[browshManager] start failed on first attempt: ${e.message}`);
      }
    }
  }

  /**
   * Boot prewarm: bring the browser up AND prove it renders (one warmup
   * render of example.com through the request mutex) so the first fetch
   * never cold-starts. HTTP-health alone is not render-ready: Firefox /
   * Marionette may still be starting when the endpoint answers, and a
   * render issued in that window hangs until the request timeout.
   * Never rejects: a failed warmup logs a warning and resolves, so boot
   * and the first fetch stay alive even when the warmup render fails.
   */
  prewarm(): Promise<void> {
    if (!this.warmup) {
      this.warmup = this.ensureStarted()
        .then(() => this.fetchRaw("https://example.com", "PLAIN"))
        .then(() => {
          console.error("[browshManager] prewarm complete (warmup render ok)");
        })
        .catch((e: unknown) => {
          console.error(
            `[browshManager] prewarm failed (continuing): ${e instanceof Error ? e.message : String(e)}`
          );
        });
    }
    return this.warmup;
  }

  /**
   * Resolve when an in-flight boot prewarm finishes; no-op when prewarm
   * never ran (BROWSH_PREWARM=0) or already settled. Lets the first fetch
   * wait for boot instead of racing it.
   */
  async awaitWarmup(): Promise<void> {
    await this.warmup;
  }

  /** Spawn the Browsh child and wait for its HTTP endpoint. */
  private async spawnAndWait(): Promise<void> {
    // Only support --http-server-mode and (optionally) --firefox.path
    const args = ["--http-server-mode"];
    if (this.firefoxPath && this.firefoxPath !== "firefox") {
      args.push("--firefox.path", this.firefoxPath);
    }
    console.error(
      `[browshManager] spawning browsh (home=%s, term=%dx%d)`,
      this.profileDir,
      this.cols,
      this.rows
    );
    const proc = spawn("browsh", args, {
      stdio: ["ignore", "inherit", "inherit"],
      // Own process group so we can tear down browsh AND its Firefox child
      // together — SIGTERM to browsh alone orphans Firefox, which then holds
      // the profile lock and blocks every subsequent restart.
      detached: true,
      env: {
        ...process.env,
        HOME: this.profileDir,
        COLUMNS: String(this.cols),
        LINES: String(this.rows),
      },
    });
    this.process = proc;

    // Node's ChildProcess.killed stays false when a child exits on its own, so
    // isRunning used to keep reporting "running" after a Go panic killed Browsh.
    // Observing the exit event directly flips state immediately, re-arms the
    // boot prewarm, and feeds the crash circuit. clearProcess() sets
    // `this.process = null` BEFORE any intentional kill, so a planned recycle,
    // idle kill, or shutdown is never miscounted as a crash.
    let childSettled = false;
    const onUnexpectedExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (childSettled) return;
      childSettled = true;
      if (this.process !== proc) return;
      this.process = null;
      this.warmup = null;
      this.lastCycleAt = Date.now();
      this.totalCrashes++;
      const opened = this.crashCircuit.record(Date.now());
      // Only a true in-window storm arms quarantine. A lifetime totalCrashes
      // check would move the profile after three crashes spaced over weeks,
      // and would ignore the configured threshold.
      if (opened) this.stormPending = true;
      console.error(
        `[browshManager] unexpected child exit (code=${code}, signal=${signal}), total=${this.totalCrashes}, burst=${this.crashCircuit.crashCount}${opened ? " — circuit OPEN" : ""}`
      );
    };
    proc.once("exit", onUnexpectedExit);
    proc.once("error", (err: Error) => {
      console.error(`[browshManager] child spawn error: ${err.message}`);
      onUnexpectedExit(-1, null);
    });

    const ready = await this.waitForReady(this.startupTimeoutMs);
    if (!ready) {
      await this.shutdown();
      throw new FetchError(BROWSH_STARTUP_TIMEOUT_MESSAGE);
    }
  }

  /** Health probe (used by ensureStarted). */
  private async waitForReady(timeoutMs: number): Promise<boolean> {
    // Only the default endpoint is possible; Browsh always uses 127.0.0.1:4333
    const endpoint = `http://127.0.0.1:4333${this.healthPath}`;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await axios.get(endpoint, { timeout: this.healthProbeTimeoutMs });
        if (res.status >= 200 && res.status < 500) return true;
      } catch {}
      await new Promise((res) => setTimeout(res, 400));
    }
    return false;
  }

  /**
   * Acquire the render slot. Delegates to the queue, which bounds the wait by
   * the caller's signal and the queue budget. See {@link RenderQueue.acquire}.
   */
  private acquire(signal?: AbortSignal): Promise<AcquireOutcome> {
    console.error("[browshManager] acquire (busy=%s, waiting=%d)", this.queue.isBusy, this.queue.pending);
    return this.queue.acquire(signal);
  }

  /** Release the render slot, handing control to the first live waiter. */
  private release(): void {
    console.error("[browshManager] release (waiting=%d)", this.queue.pending);
    this.queue.release();
  }

  /**
   * Make a request using the running Browsh instance in the specified mode.
   * Wrapped in the mutex; on completion (success or failure) the idle timer is
   * reset and a recycle decision is made — both strictly OUTSIDE the critical
   * section so no cycle can be entered mid-request.
   */
  private async fetchRaw(
    url: string,
    mode: "PLAIN" | "DOM",
    signal?: AbortSignal
  ): Promise<string> {
    // Reject before queueing while the breaker is open. A queued render would
    // otherwise occupy the single slot only to discover the browser is down.
    const now = Date.now();
    if (this.crashCircuit.isOpen(now)) {
      throw new FetchError(
        `Browsh circuit open after repeated crashes; retry in ${this.crashCircuit.remainingMs(now)}ms`,
        { url }
      );
    }
    const outcome = await this.acquire(signal);
    if (!outcome.granted) {
      // The wait ended without the mutex: the request was aborted, or it sat
      // behind the mutex past the queue budget. No render was attempted and the
      // mutex was never taken, so nothing is released here.
      throw new FetchError(
        outcome.reason === "aborted"
          ? "Render cancelled: the request was aborted before it could acquire the browser"
          : `Render failed: the request waited behind the browser mutex for more than ${this.queueTimeoutMs}ms without being served`,
        { url }
      );
    }
    try {
      return await this.fetchRawInner(url, mode, false, signal);
    } finally {
      this.release();
      this.resetIdleTimer();
      this.scheduleRecycle();
    }
  }

  /**
   * Single rendered request against 127.0.0.1:4333. If a recycling/idle kill
   * just tore down the process a transport-level failure gets ONE transparent
   * retry: respawn and re-issue the same request. Bounded to a single retry so
   * a genuinely dead target still errors fast.
   */
  private async fetchRawInner(
    url: string,
    mode: "PLAIN" | "DOM",
    retried: boolean,
    signal?: AbortSignal
  ): Promise<string> {
    const justCycled = Date.now() - this.lastCycleAt < 2000;
    if (!this.isRunning) {
      // Race: a recycle may have fired in the quiet gap between ensureStarted
      // and this request's mutex acquisition. Respawn and retry once.
      if (!retried && justCycled) {
        console.error(
          "[browshManager] Retrying '%s' after browser recycle (not running)",
          url
        );
        await this.ensureStarted();
        return this.fetchRawInner(url, mode, true, signal);
      }
      throw new FetchError("Browsh not running", { url });
    }
    const browshUrl = `http://127.0.0.1:4333/${url}`;
    try {
      const res = await axios.get(browshUrl, {
        headers: { "X-Browsh-Raw-Mode": mode },
        timeout: this.requestTimeoutMs,
        signal,
      });
      this.requestCount++;
      return res.data as string;
    } catch (error) {
      // Caller-initiated cancellation (engine race abort) passes through.
      if (axios.isCancel(error) || (axios.isAxiosError(error) && error.code === "ERR_CANCELED")) {
        throw error;
      }
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;
        // A dying instance can answer 5xx right before teardown completes —
        // treat status >= 500 during the cycle window like a transport failure.
        if (!retried && justCycled && status >= 500) {
          console.error(
            "[browshManager] Retrying '%s' after browser recycle (http %d)",
            url,
            status
          );
          this.clearProcess();
          await this.ensureStarted();
          return this.fetchRawInner(url, mode, true, signal);
        }
        const body = typeof error.response.data === "string" ? error.response.data : "";
        throw new FetchError(
          body && !body.includes("<html") ? body.trim().slice(0, 300) : `Request failed with status ${status}`,
          { statusCode: status, url }
        );
      }
      // Transport-level failure (timeout, ECONNRESET, refused). Retry once
      // when the browser was recently cycled OR is clearly down (ECONNREFUSED
      // means the renderer port is gone — e.g. the browser crashed on its own,
      // which no recycle path had a chance to record).
      const isBrowserDown =
        axios.isAxiosError(error) &&
        (error.code === "ECONNREFUSED" ||
          error.code === "ECONNRESET" ||
          error.code === "EHOSTUNREACH" ||
          error.code === "ENETUNREACH");
      if (!retried && (justCycled || isBrowserDown)) {
        console.error(
          "[browshManager] Retrying '%s' after browser teardown (%s)",
          url,
          error instanceof Error ? error.message : String(error)
        );
        this.clearProcess();
        await this.ensureStarted();
        return this.fetchRawInner(url, mode, true, signal);
      }
      if (axios.isAxiosError(error)) {
        const msg = error.message ?? "unknown transport error";
        const timedOut = error.code === "ECONNABORTED" || msg.toLowerCase().includes("timeout");
        // D1: a render timeout is transient and URL-scoped — say so explicitly
        // so batch callers know the item (not the batch) failed and a retry
        // of the single URL is safe. The mutex is released by fetchRaw's
        // finally, so siblings proceed unaffected.
        throw new FetchError(
          timedOut
            ? `Request failed: ${msg} (transient render timeout after ${this.requestTimeoutMs}ms; retry this URL alone or in a smaller batch)`
            : `Request failed: ${msg}`,
          { url }
        );
      }
      throw error;
    }
  }

  /** Tear down the browser process group (browsh + Firefox) if present. */
  private clearProcess(): void {
    const proc = this.process;
    this.process = null;
    if (!proc || proc.killed) return;
    this.lastCycleAt = Date.now();
    try {
      // Negative PID = whole process group (requires detached: true on spawn).
      process.kill(-proc.pid!, "SIGTERM");
    } catch {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    // Belt-and-braces: if the group is still alive after 2s, force SIGKILL so
    // the next restart never fights an orphaned Firefox/profile lock.
    setTimeout(() => {
      if (!proc.killed) {
        try {
          process.kill(-proc.pid!, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }, 2000).unref();
  }

  /**
   * Schedule a recycle on the next macrotask, but ONLY when the browser is
   * quiescent: nothing actively fetching (`busy`) and nothing queued
   * (`waiting`). This prevents killing the process while a handed-off waiter
   * has already begun its request (enrichment fan-out, batch fetches). If the
   * browser is still busy, re-schedule — a quiet gap will appear because the
   * requestCount keeps accumulating.
   */
  private scheduleRecycle(): void {
    if (this.requestCount < this.recycleThreshold) return;
    setImmediate(() => {
      // Re-check the counter: an earlier queued callback may have recycled and
      // reset it already, so a new process must not be immediately killed.
      if (this.requestCount < this.recycleThreshold) return;
      if (this.queue.isBusy || this.queue.pending > 0) {
        this.scheduleRecycle();
        return;
      }
      void this.recycle();
    });
  }

  /**
   * Kill the process and reset the counter; the next ensureStarted() spins up
   * a fresh instance (lazy restart). Only called from scheduleRecycle when the
   * mutex is uncontended.
   */
  private async recycle(): Promise<void> {
    console.error("[browshManager] Recycling after %d requests", this.requestCount);
    await this.acquire();
    try {
      this.clearProcess();
      this.requestCount = 0;
    } finally {
      this.release();
    }
  }

  /** Arm/refresh the idle-kill timer. */
  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.idleKill(), this.idleTimeoutMs);
  }

  /** Kill the browser after prolonged inactivity; also mops the render cache. */
  private async idleKill(): Promise<void> {
    console.error("[browshManager] Idle timeout reached, killing browser");
    await this.acquire();
    try {
      this.clearProcess();
      this.requestCount = 0;
      pageCache.clear();
    } finally {
      this.release();
    }
  }

  /** Fetches JS-rendered plain text. */
  async fetchPlain(url: string, signal?: AbortSignal): Promise<string> {
    const raw = await this.fetchRaw(url, "PLAIN", signal);
    return cleanPlainText(raw);
  }

  /** Fetches JS-rendered HTML (DOM). */
  async fetchDom(url: string, signal?: AbortSignal): Promise<string> {
    return this.fetchRaw(url, "DOM", signal);
  }

  /** Cleanly shutdown process (called once at server exit). */
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.clearProcess();
  }

  /** Returns true if Browsh is running. */
  get isRunning() {
    const proc = this.process;
    return (
      proc !== null &&
      !proc.killed &&
      proc.exitCode === null &&
      proc.signalCode === null
    );
  }

  /**
   * Current render-slot pressure, for callers that can shed optional work.
   * Enrichment and other best-effort phases skip themselves when a caller is
   * already waiting, so a search stops inflating the queue it is stuck behind.
   */
  get queuePressure(): { busy: boolean; pending: number } {
    return { busy: this.queue.isBusy, pending: this.queue.pending };
  }
}

export const browshManager = new BrowshManager();

/**
 * Move a suspect profile dir aside (`<dir>.corrupt-<ts>`) and recreate it
 * empty. Exported for unit testing. Returns the backup path, or null when
 * the rename failed (caller retries against the same dir once anyway).
 *
 * SAFETY (default-deny allowlist): BROWSH_PROFILE_DIR is operator-controlled
 * env input, and this function renames that path — so it refuses anything
 * outside the known profile bases (/data, os.tmpdir()), refuses the bases
 * themselves, and refuses shallow paths (depth < 3, e.g. "/x"). A typo like
 * BROWSH_PROFILE_DIR=/ can never move host data aside. Returns null on
 * refusal (loud warning); the caller then rethrows instead of retrying.
 */
export function quarantineProfileDir(profileDir: string): string | null {
  const resolved = path.resolve(profileDir);
  const dataRoot = path.resolve("/data");
  const tmpRoot = path.resolve(os.tmpdir());
  const under = (root: string): boolean =>
    resolved === root || resolved.startsWith(root + path.sep);
  const depth = resolved.split(path.sep).length;
  const allowed =
    (under(dataRoot) && resolved !== dataRoot && depth >= 3) ||
    (under(tmpRoot) && resolved !== tmpRoot && depth >= 3);
  if (!allowed) {
    console.error(
      `[browshManager] quarantine REFUSED for unexpected profile dir: ${resolved} (not under /data or TMP)`
    );
    return null;
  }
  const backup = `${profileDir}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(profileDir, backup);
    console.error(
      `[browshManager] quarantined suspect profile to ${backup}, retrying fresh`
    );
    fs.mkdirSync(profileDir, { recursive: true });
    return backup;
  } catch {
    return null;
  }
}