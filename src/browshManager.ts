import { spawn, ChildProcess } from "child_process";
import axios from "axios";
import { FetchError } from "./errors.js";
import { pageCache } from "./cache.js";

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
  private process: ChildProcess | null = null;
  private readonly firefoxPath: string;
  private readonly healthPath: string = "/";
  private readonly requestTimeoutMs: number;
  private readonly recycleThreshold: number;
  private readonly idleTimeoutMs: number;

  private requestCount = 0;
  private busy = false;
  private waiting: Array<() => void> = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCycleAt = 0;

  constructor(firefoxPath?: string) {
    // Get path from env or default to "firefox"
    this.firefoxPath =
      firefoxPath || process.env.BROWSH_FIREFOX_PATH || "firefox";
    this.requestTimeoutMs = Number(process.env.BROWSH_REQUEST_TIMEOUT_MS) || 30_000;
    this.recycleThreshold = Number(process.env.BROWSH_RECYCLE_REQUESTS) || 100;
    this.idleTimeoutMs = Number(process.env.BROWSH_IDLE_TIMEOUT_MS) || 600_000;
  }

  /** Start Browsh if not running. */
  async ensureStarted(): Promise<void> {
    if (this.isRunning) return;
    // Only support --http-server-mode and (optionally) --firefox.path
    const args = ["--http-server-mode"];
    if (this.firefoxPath && this.firefoxPath !== "firefox") {
      args.push("--firefox.path", this.firefoxPath);
    }
    this.process = spawn("browsh", args, {
      stdio: ["ignore", "inherit", "inherit"],
      // Own process group so we can tear down browsh AND its Firefox child
      // together — SIGTERM to browsh alone orphans Firefox, which then holds
      // the profile lock and blocks every subsequent restart.
      detached: true,
    });
    const ready = await this.waitForReady(30000);
    if (!ready) {
      await this.shutdown();
      throw new FetchError(`Browsh did not start in HTTP mode within timeout`);
    }
  }

  /** Health probe (used by ensureStarted). */
  private async waitForReady(timeoutMs: number): Promise<boolean> {
    // Only the default endpoint is possible; Browsh always uses 127.0.0.1:4333
    const endpoint = `http://127.0.0.1:4333${this.healthPath}`;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await axios.get(endpoint, { timeout: 800 });
        if (res.status >= 200 && res.status < 500) return true;
      } catch {}
      await new Promise((res) => setTimeout(res, 400));
    }
    return false;
  }

  /**
   * Acquire the busy mutex. Browsh requests are strictly serialized: if a
   * request is in flight, waiters queue in FIFO order. This guarantees any
   * recycle/idle-kill decided later only ever sees a quiescent process.
   */
  private async acquire(): Promise<void> {
    console.error("[browshManager] acquire (busy=%s, waiting=%d)", this.busy, this.waiting.length);
    if (!this.busy) {
      this.busy = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /** Release the mutex, handing control to the first waiter if any. */
  private release(): void {
    console.error("[browshManager] release (waiting=%d)", this.waiting.length);
    if (this.waiting.length > 0) {
      this.waiting.shift()!();
    } else {
      this.busy = false;
    }
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
    await this.acquire();
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
        throw new FetchError(`Request failed: ${error.message}`, { url });
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
      if (this.busy || this.waiting.length > 0) {
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
    return this.fetchRaw(url, "PLAIN", signal);
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
    return this.process !== null && !this.process.killed;
  }
}

export const browshManager = new BrowshManager();