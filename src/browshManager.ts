import { spawn, ChildProcess } from "child_process";
import axios from "axios";

class BrowshManager {
  private process: ChildProcess | null = null;
  private readonly firefoxPath: string;
  private readonly healthPath: string = "/";

  constructor(firefoxPath?: string) {
    // Get path from env or default to "firefox"
    this.firefoxPath =
      firefoxPath || process.env.BROWSH_FIREFOX_PATH || "firefox";
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
    });
    const ready = await this.waitForReady(10000);
    if (!ready) {
      await this.shutdown();
      throw new Error(`Browsh did not start in HTTP mode within timeout`);
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

  /** Make a request using the running Browsh instance in the specified mode. */
  private async fetchRaw(url: string, mode: "PLAIN" | "DOM"): Promise<string> {
    if (!this.isRunning) throw new Error("Browsh not running");
    // Always use default Browsh endpoint; port/host are not configurable
    const browshUrl = `http://127.0.0.1:4333/${url}`;
    return axios
      .get(browshUrl, {
        headers: { "X-Browsh-Raw-Mode": mode },
        timeout: 20000,
      })
      .then((res) => res.data as string);
  }

  /** Fetches JS-rendered plain text. */
  async fetchPlain(url: string): Promise<string> {
    return this.fetchRaw(url, "PLAIN");
  }

  /** Fetches JS-rendered HTML (DOM). */
  async fetchDom(url: string): Promise<string> {
    return this.fetchRaw(url, "DOM");
  }

  /** Cleanly shutdown process (called once at server exit). */
  async shutdown(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  /** Returns true if Browsh is running. */
  get isRunning() {
    return this.process !== null && !this.process.killed;
  }
}

export const browshManager = new BrowshManager();
