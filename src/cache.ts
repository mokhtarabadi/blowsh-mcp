/** Small in-memory TTL cache. */
export class TtlCache<K, V> {
  private store = new Map<K, { expiresAt: number; value: V }>();

  constructor(private readonly ttlMs: number = 300_000) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { expiresAt: Date.now() + this.ttlMs, value });
  }

  clear(): void {
    this.store.clear();
  }
}

/** Global cache for rendered pages, keyed by fetch options. */
export const pageCache = new TtlCache<string, string>(
  Number(process.env.CACHE_TTL_MS) || 300_000
);

export function cacheKey(url: string, suffix: string): string {
  return `${url}\u0000${suffix}`;
}