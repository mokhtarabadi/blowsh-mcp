/**
 * Env-driven proxy configuration regression tests.
 * Run with: npx tsx tests/proxy-config-tests.ts
 *
 * Scope: pure functions only. No Browsh, no Firefox, no network. The tests
 * cover the six-variable contract resolved from .env into axios env vars and
 * Firefox `user.js` preferences, including the error paths and the invariant
 * that the 127.0.0.1:4333 Browsh control channel is always bypassed.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyProxyEnv,
  buildFirefoxUserJs,
  ensureFirefoxProxyPrefs,
  parseBypass,
  resolveProxyConfig,
} from "../src/proxyConfig.js";

let failures = 0;
let checks = 0;

function check(name: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`ok ${checks} - ${name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`not ok ${checks} - ${name}\n  ${message}`);
  }
}

function expectThrow(name: string, fn: () => void, fragment: string): void {
  check(name, () => {
    assert.throws(fn, (error: unknown) => {
      assert.ok(error instanceof Error, "expected an Error");
      assert.ok(error.message.includes(fragment), `expected message to include '${fragment}', got '${error.message}'`);
      return true;
    });
  });
}

// T1 — direct mode writes type 0 and no proxy host.
check("T1 direct mode writes network.proxy.type 0 with no proxy host", () => {
  const config = resolveProxyConfig({ PROXY_TYPE: "none" });
  const userJs = buildFirefoxUserJs(config);
  assert.equal(config.type, "none");
  assert.ok(userJs.includes('user_pref("network.proxy.type", 0);'));
  assert.ok(!userJs.includes("network.proxy.http"));
  assert.ok(!userJs.includes("network.proxy.socks"));
});

// T2 — HTTP mode maps host, port, ssl and bypass.
check("T2 http mode writes type 1 with quoted host and integer port and shared ssl", () => {
  const config = resolveProxyConfig({
    PROXY_TYPE: "http",
    PROXY_HOST: "proxy.example.com",
    PROXY_PORT: "8080",
  });
  const userJs = buildFirefoxUserJs(config);
  assert.ok(userJs.includes('user_pref("network.proxy.type", 1);'));
  assert.ok(userJs.includes('user_pref("network.proxy.http", "proxy.example.com");'));
  assert.ok(userJs.includes("user_pref(\"network.proxy.http_port\", 8080);"));
  assert.ok(userJs.includes('user_pref("network.proxy.ssl", "proxy.example.com");'));
  assert.ok(userJs.includes("user_pref(\"network.proxy.ssl_port\", 8080);"));
  assert.ok(userJs.includes('user_pref("network.proxy.share_proxy_settings", true);'));
});

// T3 — SOCKS5 mode maps socks host, version and remote DNS.
check("T3 socks5 mode writes socks host integer port version 5 and remote DNS", () => {
  const config = resolveProxyConfig({
    PROXY_TYPE: "socks5",
    PROXY_HOST: "socks.example.com",
    PROXY_PORT: "1080",
  });
  const userJs = buildFirefoxUserJs(config);
  assert.ok(userJs.includes('user_pref("network.proxy.socks", "socks.example.com");'));
  assert.ok(userJs.includes("user_pref(\"network.proxy.socks_port\", 1080);"));
  assert.ok(userJs.includes("user_pref(\"network.proxy.socks_version\", 5);"));
  assert.ok(userJs.includes("user_pref(\"network.proxy.socks_remote_dns\", true);"));
});

// T4 — custom bypass merges with loopbacks and survives omission.
check("T4 custom bypass merges loopbacks and deduplicates", () => {
  const bypass = parseBypass("example.com, localhost, EXAMPLE.com");
  assert.ok(bypass.includes("example.com"));
  assert.ok(bypass.includes("localhost"));
  assert.ok(bypass.includes("127.0.0.1"));
  assert.equal(bypass.filter((item) => item.toLowerCase() === "example.com").length, 1);
  const defaults = parseBypass(undefined);
  assert.deepEqual(defaults, ["localhost", "127.0.0.1"]);
});

// T5 — missing host or port fails startup.
expectThrow(
  "T5a missing PROXY_HOST throws",
  () => resolveProxyConfig({ PROXY_TYPE: "http", PROXY_PORT: "8080" }),
  "PROXY_HOST is required"
);
expectThrow(
  "T5b missing PROXY_PORT throws",
  () => resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com" }),
  "PROXY_PORT is required"
);

// T6 — invalid type or port fails startup.
expectThrow(
  "T6a invalid PROXY_TYPE throws",
  () => resolveProxyConfig({ PROXY_TYPE: "ftp", PROXY_HOST: "proxy.example.com", PROXY_PORT: "8080" }),
  "Invalid PROXY_TYPE"
);
expectThrow(
  "T6b non-numeric PROXY_PORT throws",
  () => resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: "abc" }),
  "Invalid PROXY_PORT"
);
expectThrow(
  "T6c out-of-range PROXY_PORT throws",
  () => resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: "65536" }),
  "Invalid PROXY_PORT"
);
expectThrow(
  "T6d password without username throws",
  () => resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: "8080", PROXY_PASSWORD: "secret" }),
  "PROXY_USERNAME is required"
);
expectThrow(
  "T6e host with scheme throws",
  () => resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "http://proxy.example.com", PROXY_PORT: "8080" }),
  "Invalid PROXY_HOST"
);

// T7 — explicit operator proxy value wins and loopbacks are always injected.
check("T7 applyProxyEnv preserves explicit HTTP_PROXY and injects loopbacks", () => {
  const config = resolveProxyConfig({
    PROXY_TYPE: "http",
    PROXY_HOST: "configured.example.com",
    PROXY_PORT: "3128",
  });
  const env: NodeJS.ProcessEnv = {
    HTTP_PROXY: "http://operator.example.com:9999",
    NO_PROXY: "internal.example.com",
  };
  applyProxyEnv(config, env);
  assert.equal(env.HTTP_PROXY, "http://operator.example.com:9999");
  assert.ok(env.NO_PROXY?.includes("internal.example.com"));
  assert.ok(env.NO_PROXY?.includes("localhost"));
  assert.ok(env.NO_PROXY?.includes("127.0.0.1"));
  assert.equal(env.no_proxy, env.NO_PROXY);
});

// T8 — stale user.js on a persistent volume is overwritten by direct mode.
check("T8 stale manual user.js is overwritten by deterministic direct mode", () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "blowsh-proxy-test-"));
  try {
    const target = path.join(profileDir, ".config", "browsh", "firefox_profile", "user.js");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'user_pref("network.proxy.type", 1);\nuser_pref("network.proxy.http", "stale");\n');
    ensureFirefoxProxyPrefs(profileDir, resolveProxyConfig({}));
    const content = fs.readFileSync(target, "utf8");
    assert.equal(content, 'user_pref("network.proxy.type", 0);\n');
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

// T9 — credentials are encoded in env, JSON-escaped in prefs, and never logged.
check("T9 special characters are encoded and escaped with no logging", () => {
  const config = resolveProxyConfig({
    PROXY_TYPE: "http",
    PROXY_HOST: "proxy.example.com",
    PROXY_PORT: "8080",
    PROXY_USERNAME: "user@name",
    PROXY_PASSWORD: 'p@ss/word:"x',
  });
  const env: NodeJS.ProcessEnv = {};
  const logged: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    applyProxyEnv(config, env);
    buildFirefoxUserJs(config);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.ok(env.HTTP_PROXY?.includes("user%40name"));
  assert.ok(env.HTTP_PROXY?.includes("p%40ss%2Fword%3A%22x"));
  const userJs = buildFirefoxUserJs(config);
  assert.ok(userJs.includes('user_pref("network.proxy.password", "p@ss/word:\\"x");'));
  assert.ok(!logged.some((line) => line.includes("p@ss")), "credentials must never be logged");
});

check("HOTFIX strict decimal port rejects hex exponent float zero", () => {
  // Note trimmed input with spaces is valid after trim in resolver, so test raw hex exponent float zero plus.
  for (const p of ["0x10", "1e3", "8080.0", "0", "65536"]) {
    assert.throws(() => resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: p }), /Invalid PROXY_PORT/);
  }
});
check("HOTFIX username without password omits colon in proxy URL", () => {
  const config = resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: "8080", PROXY_USERNAME: "bob" });
  const env: NodeJS.ProcessEnv = {};
  applyProxyEnv(config, env);
  assert.equal(env.HTTP_PROXY, "http://bob@proxy.example.com:8080");
  assert.ok(!env.HTTP_PROXY?.includes("bob:@"));
});
check("HOTFIX dual NO_PROXY casings both preserved plus loopbacks", () => {
  const config = resolveProxyConfig({ PROXY_TYPE: "http", PROXY_HOST: "proxy.example.com", PROXY_PORT: "3128" });
  const env: NodeJS.ProcessEnv = { NO_PROXY: "a.example.com", no_proxy: "b.example.com" };
  applyProxyEnv(config, env);
  assert.ok(env.NO_PROXY?.includes("a.example.com"));
  assert.ok(env.NO_PROXY?.includes("b.example.com"));
  assert.ok(env.NO_PROXY?.includes("localhost"));
  assert.ok(env.NO_PROXY?.includes("127.0.0.1"));
  assert.equal(env.no_proxy, env.NO_PROXY);
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
