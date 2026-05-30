/**
 * LruCache — a `Map` with a bounded size and least-recently-used eviction.
 *
 * Drop-in for `Map<K, V>`: reading via `get()` marks the entry most-recently-
 * used; `set()` evicts the least-recently-used entries once `maxSize` is
 * exceeded. Used to bound caches that would otherwise grow per-keystroke for a
 * whole session (e.g. codePreview render cache — WI-4.4, R1).
 *
 * @module utils/lruCache
 */
export class LruCache<K, V> extends Map<K, V> {
  private readonly maxSize: number;

  constructor(maxSize: number) {
    super();
    if (maxSize < 1) {
      throw new Error("LruCache maxSize must be >= 1");
    }
    this.maxSize = maxSize;
  }

  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key) as V;
    // Re-insert so this key becomes most-recently-used (Map keeps insertion order).
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: K, value: V): this {
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    while (this.size > this.maxSize) {
      const oldest = super.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      super.delete(oldest);
    }
    return this;
  }
}
