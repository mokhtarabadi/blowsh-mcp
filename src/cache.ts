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

  /**
   * Live entry count (expired entries purged first). Used by bounded
   * caches (e.g. guard verdicts) to enforce a max-size LRU-ish cap.
   */
  get size(): number {
    this.purgeExpired();
    return this.store.size;
  }

  /** Remove the oldest-inserted entry (Map preserves insertion order). */
  deleteOldest(): void {
    const oldest = this.store.keys().next();
    if (!oldest.done) this.store.delete(oldest.value);
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [k, e] of this.store) {
      if (now > e.expiresAt) this.store.delete(k);
    }
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