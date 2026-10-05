// In-memory LRU with TTL + per-key sliding-window rate limiter. Per server instance (fine at launch scale:
// a Vercel instance serves many requests; a cold one starts empty, which only means an extra provider call).

export class LruCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(
    private max: number,
    private ttlMs: number,
    private now: () => number = Date.now,
  ) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.map.delete(k);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }
  set(k: string, v: V) {
    this.map.delete(k);
    this.map.set(k, { v, exp: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  get size() {
    return this.map.size;
  }
}

/** At most `limit` hits per `windowMs` per key. `take` returns 0 when allowed, else ms until the next slot. */
export function slidingWindow(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    take(key: string): number {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return recent[0] + windowMs - t;
      }
      recent.push(t);
      hits.set(key, recent);
      // Keep the map small: drop idle keys now and then.
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => x > t - windowMs)) hits.delete(k);
      return 0;
    },
  };
}
