import dns from "node:dns/promises";
import net from "node:net";
import { FetchError } from "./errors.js";

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_URLS === "true";

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const BLOCKED_IPV4: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc6120000, 0xc633ffff], // 198.18.0.0/15
  [0xe0000000, 0xfbffffff], // 224.0.0.0/4 (multicast + reserved)
];

const BLOCKED_IPV6 = ["fc00::/7", "fe80::/10", "::1/128", "::/128", "::ffff:0:0/96", "2001:db8::/32"];

function ipv6Blocked(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::" || low.startsWith("fe80:") || low.startsWith("fc") || low.startsWith("fd")) return true;
  if (low.startsWith("::ffff:")) {
    const v4 = low.slice("::ffff:".length).replace(/\./g, "").padStart(8, "0");
    const int = parseInt(v4.slice(0, 8) || "0", 16) >>> 0;
    return BLOCKED_IPV4.some(([a, b]) => int >= a && int <= b);
  }
  return low.startsWith("2001:db8:");
}

export async function isPrivateAddress(address: string): Promise<boolean> {
  if (net.isIPv6(address)) return ipv6Blocked(address);
  if (net.isIPv4(address)) {
    const int = ipv4ToInt(address);
    return BLOCKED_IPV4.some(([a, b]) => int >= a && int <= b);
  }
  return false;
}

/**
 * SSRF guard: rejects URLs whose host resolves to loopback, private, link-local,
 * reserved, or IPv4-mapped-IPv6 addresses. Hostname resolution is performed via DNS.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  if (ALLOW_PRIVATE) return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new FetchError("Invalid URL", { url: rawUrl });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FetchError(`Unsupported protocol '${parsed.protocol}' (only http/https)`, {
      url: rawUrl,
    });
  }
  if (parsed.username || parsed.password) {
    throw new FetchError("URLs with embedded credentials are not allowed", { url: rawUrl });
  }
  const host = parsed.hostname;
  if (net.isIP(host) || host === "localhost") {
    if (await isPrivateAddress(host)) {
      throw new FetchError(`SSRF guard: refused to fetch private address '${host}'`, { url: rawUrl });
    }
    return;
  }
  let addresses: string[];
  try {
    addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new FetchError(`Could not resolve hostname '${host}'`, { url: rawUrl });
  }
  for (const address of addresses) {
    if (await isPrivateAddress(address)) {
      throw new FetchError(`SSRF guard: '${host}' resolves to private address '${address}'`, {
        url: rawUrl,
      });
    }
  }
}