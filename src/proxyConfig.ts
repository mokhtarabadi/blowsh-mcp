// Sibling Docs: ./README.md | Decisions: ./DECISIONS.md
// Proxy resolution for Docker deployments: .env PROXY_* drives axios env and Firefox user.js.
// Never log resolved passwords or generated pref values.

import * as fs from "node:fs";
import * as path from "node:path";

/** Supported upstream proxy protocols. `none` forces deterministic direct mode. */
export type ProxyType = "none" | "http" | "socks5";

/**
 * Fully resolved proxy configuration.
 *
 * `port` is `null` only in direct mode. `bypass` always contains `localhost`
 * and `127.0.0.1` so the Browsh loopback control channel can never be proxied.
 */
export interface ProxyConfig {
  type: ProxyType;
  host: string;
  port: number | null;
  username: string;
  password: string;
  bypass: string[];
}

/** Loopback hosts that must never be sent through an upstream proxy. */
const LOOPBACKS = ["localhost", "127.0.0.1"];

/**
 * Deduplicate case-insensitively while preserving the first occurrence's case.
 * Used for both the bypass list and the inherited NO_PROXY variable.
 */
function dedupLowerPreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(raw);
    }
  }
  return out;
}

/**
 * Parse the `PROXY_BYPASS` comma list and always append the loopback hosts.
 *
 * @param raw operator-supplied bypass list; undefined means the default list.
 * @returns deduplicated list with `localhost` and `127.0.0.1` guaranteed.
 */
export function parseBypass(raw: string | undefined): string[] {
  const base = (raw ?? "localhost,127.0.0.1")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const merged = dedupLowerPreserve([
    ...base,
    ...LOOPBACKS.filter((loopback) => !base.map((item) => item.toLowerCase()).includes(loopback.toLowerCase())),
  ]);
  return merged;
}

/**
 * Resolve and validate the six-variable `.env` contract (D1-D4, D6).
 *
 * Fails fast on an invalid type, a missing or malformed host/port for an
 * active type, or a password without a username. Error messages never include
 * the password value.
 *
 * @param env environment to read; defaults to `process.env`.
 * @returns validated configuration.
 */
export function resolveProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const rawType = (env.PROXY_TYPE ?? "none").trim().toLowerCase();
  if (rawType !== "none" && rawType !== "http" && rawType !== "socks5") {
    throw new Error(`Invalid PROXY_TYPE '${env.PROXY_TYPE}': expected none|http|socks5`);
  }
  const type = rawType as ProxyType;
  const host = (env.PROXY_HOST ?? "").trim();
  const portRaw = (env.PROXY_PORT ?? "").trim();
  const username = (env.PROXY_USERNAME ?? "").trim();
  const password = (env.PROXY_PASSWORD ?? "").trim();
  const bypass = parseBypass(env.PROXY_BYPASS);

  if (type === "none") {
    return { type, host: "", port: null, username: "", password: "", bypass };
  }
  if (host.length === 0) throw new Error("PROXY_HOST is required when PROXY_TYPE is http or socks5");
  if (host.includes("://") || host.includes("/")) {
    throw new Error(`Invalid PROXY_HOST '${host}': must be hostname or IP without scheme or path`);
  }
  if (host.includes(":") && !(host.startsWith("[") && host.endsWith("]"))) {
    throw new Error(`Invalid PROXY_HOST '${host}': must not include port; set PROXY_PORT separately (use [::1] form for IPv6)`);
  }
  if (portRaw.length === 0) throw new Error("PROXY_PORT is required when PROXY_TYPE is http or socks5");
  if (!/^\d+$/.test(portRaw)) {
    throw new Error(`Invalid PROXY_PORT '${portRaw}': expected integer 1-65535`);
  }
  const port = Number.parseInt(portRaw, 10);
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid PROXY_PORT '${portRaw}': expected integer 1-65535`);
  }
  if (password.length > 0 && username.length === 0) {
    throw new Error("PROXY_USERNAME is required when PROXY_PASSWORD is set");
  }
  return { type, host, port, username, password, bypass };
}

/**
 * Build the Firefox `user.js` content for the resolved configuration.
 *
 * Direct mode writes exactly one preference so a stale file left on the
 * `/data/browsh-profile` volume cannot keep a proxy active. String values are
 * JSON-escaped; integers and booleans are emitted raw, matching Browsh's
 * Marionette preference setter.
 *
 * @param config validated proxy configuration.
 * @returns complete `user.js` text, ending with a newline.
 */
export function buildFirefoxUserJs(config: ProxyConfig): string {
  if (config.type === "none") return 'user_pref("network.proxy.type", 0);\n';
  const lines: string[] = ['user_pref("network.proxy.type", 1);'];
  const noProxies = config.bypass.join(", ");
  if (config.type === "http") {
    lines.push(`user_pref("network.proxy.http", ${JSON.stringify(config.host)});`);
    lines.push(`user_pref("network.proxy.http_port", ${config.port});`);
    lines.push(`user_pref("network.proxy.ssl", ${JSON.stringify(config.host)});`);
    lines.push(`user_pref("network.proxy.ssl_port", ${config.port});`);
    lines.push('user_pref("network.proxy.share_proxy_settings", true);');
  } else {
    lines.push(`user_pref("network.proxy.socks", ${JSON.stringify(config.host)});`);
    lines.push(`user_pref("network.proxy.socks_port", ${config.port});`);
    lines.push("user_pref(\"network.proxy.socks_version\", 5);");
    lines.push("user_pref(\"network.proxy.socks_remote_dns\", true);");
  }
  lines.push(`user_pref("network.proxy.no_proxies_on", ${JSON.stringify(noProxies)});`);
  if (config.username.length > 0) lines.push(`user_pref("network.proxy.username", ${JSON.stringify(config.username)});`);
  if (config.password.length > 0) lines.push(`user_pref("network.proxy.password", ${JSON.stringify(config.password)});`);
  return lines.join("\n") + "\n";
}

/**
 * Write the Firefox preference file into the redirected Browsh profile.
 *
 * The path is `<profileDir>/.config/browsh/firefox_profile/user.js`; with the
 * Docker default profile root this is
 * `/data/browsh-profile/.config/browsh/firefox_profile/user.js`. The file is
 * overwritten on every boot, which defeats stale volume state.
 *
 * @param profileDir Browsh child HOME, normally `BROWSH_PROFILE_DIR`.
 * @param config validated proxy configuration.
 * @returns absolute path of the written file.
 */
export function ensureFirefoxProxyPrefs(profileDir: string, config: ProxyConfig): string {
  const dir = path.join(profileDir, ".config", "browsh", "firefox_profile");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "user.js");
  fs.writeFileSync(file, buildFirefoxUserJs(config), "utf8");
  return file;
}

/** Merge inherited NO_PROXY entries with the configured bypass list. */
function mergeNoProxy(existing: string | undefined, bypass: string[]): string {
  const parts = (existing ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return dedupLowerPreserve([...parts, ...bypass]).join(",");
}

/**
 * Seed axios proxy environment variables once at startup (D5).
 *
 * `proxy-from-env` already makes axios honor `<scheme>_proxy` and `NO_PROXY`;
 * no per-callsite change is required. Explicit operator values always win,
 * while the loopback bypass is always merged in so the `127.0.0.1:4333`
 * control channel stays direct.
 *
 * @param config validated proxy configuration.
 * @param env environment object to mutate; defaults to `process.env`.
 */
export function applyProxyEnv(config: ProxyConfig, env: NodeJS.ProcessEnv = process.env): void {
  const inheritedParts: string[] = [];
  if (typeof env.NO_PROXY === "string" && env.NO_PROXY.length > 0) inheritedParts.push(env.NO_PROXY);
  if (typeof env.no_proxy === "string" && env.no_proxy.length > 0) inheritedParts.push(env.no_proxy);
  const inherited = inheritedParts.join(",");
  const merged = mergeNoProxy(inherited.length > 0 ? inherited : undefined, config.bypass);
  env.NO_PROXY = merged;
  env.no_proxy = merged;
  if (config.type === "none") return;

  const auth = config.username.length > 0
    ? config.password.length > 0
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : `${encodeURIComponent(config.username)}@`
    : "";
  const scheme = config.type === "http" ? "http" : "socks5h";
  const value = `${scheme}://${auth}${config.host}:${config.port}`;

  if (!env.HTTP_PROXY && !env.http_proxy) {
    env.HTTP_PROXY = value;
    env.http_proxy = value;
  } else if (!env.HTTP_PROXY && env.http_proxy) {
    env.HTTP_PROXY = env.http_proxy;
  } else if (!env.http_proxy && env.HTTP_PROXY) {
    env.http_proxy = env.HTTP_PROXY;
  }

  if (!env.HTTPS_PROXY && !env.https_proxy) {
    env.HTTPS_PROXY = value;
    env.https_proxy = value;
  } else if (!env.HTTPS_PROXY && env.https_proxy) {
    env.HTTPS_PROXY = env.https_proxy;
  } else if (!env.https_proxy && env.HTTPS_PROXY) {
    env.https_proxy = env.HTTPS_PROXY;
  }
}
