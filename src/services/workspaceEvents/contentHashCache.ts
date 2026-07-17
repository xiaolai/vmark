/**
 * Content-hash cache — last-known content fingerprint per path.
 *
 * Purpose: Lets the workspace event layer suppress *no-op* changes — an
 *   external `touch`, a formatter that rewrote a file to identical bytes, a
 *   git op that restored the same content, a revert-to-identical. The Rust
 *   watcher reports "a path was touched"; this cache is how VMark upgrades that
 *   to "the content actually changed" (the recursion-engine lesson: fs-change
 *   ≠ semantic-change). Self-write echoes are handled separately by
 *   `pendingSaves`; this catches the *external* no-op class they miss.
 *
 * Pure and in-memory: a `Map<normalizedPath, hash>` plus a fast non-cryptographic
 * fingerprint. A hash collision only ever costs one missed suppression (a false
 * "changed" — the safe direction), never a missed real edit.
 *
 * @coordinates-with services/workspaceEvents/suppressUnchanged — sole consumer
 * @module services/workspaceEvents/contentHashCache
 */

/**
 * Fingerprint file content for change detection. Two independent 32-bit hashes
 * (FNV-1a-style, different seeds + mixers) plus the length give a ~64-bit
 * fingerprint, so a collision that would falsely suppress a real edit is
 * vanishingly unlikely. Callers compare fingerprints for equality only — the
 * value is not stable across engines and must not be persisted.
 */
export function hashContent(content: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca77);
  }
  return `${content.length}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

/** Per-path last-known content fingerprint. Callers pass normalized paths. */
export interface ContentHashCache {
  /** Last-known fingerprint for the path, or `undefined` if unseen. */
  get(path: string): string | undefined;
  /** Record the current fingerprint for the path. */
  set(path: string, hash: string): void;
  /** Drop the path (deleted / unreadable / re-baseline). */
  forget(path: string): void;
  /** Move a fingerprint across a rename (content is unchanged by a move). */
  rename(oldPath: string, newPath: string): void;
  /** Drop every entry. */
  clear(): void;
  /** Number of cached paths (diagnostics/tests). */
  size(): number;
}

/**
 * Cap on tracked paths. The cache only records paths that emit change events, so
 * this bounds memory on a long-lived, high-churn workspace. Eviction is FIFO
 * (Map preserves insertion order); a rare eviction only costs one re-baseline (a
 * kept event on the next change), never a missed change.
 */
const MAX_ENTRIES = 5000;

/** Create an empty content-hash cache. */
export function createContentHashCache(): ContentHashCache {
  const map = new Map<string, string>();
  return {
    get: (path) => map.get(path),
    set: (path, hash) => {
      if (!map.has(path) && map.size >= MAX_ENTRIES) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(path, hash);
    },
    forget: (path) => {
      map.delete(path);
    },
    rename: (oldPath, newPath) => {
      const hash = map.get(oldPath);
      map.delete(oldPath);
      if (hash !== undefined) map.set(newPath, hash);
      else map.delete(newPath);
    },
    clear: () => map.clear(),
    size: () => map.size,
  };
}
