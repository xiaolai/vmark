/**
 * Lazy format-surface resolution (WI-13).
 *
 * Purpose: turn a `FormatConfig` import thunk into a resolved surface exactly
 *   once, with the failure semantics decision-ledger entry **D4** pins.
 *
 *   `bootstrapFormats()` runs unconditionally in every window — Settings and
 *   PDF export included — before `import("./App")`. Anything an adapter
 *   reaches statically is therefore cold-start cost for windows that never
 *   open an editor, which is why `wysiwygComponent` and `language` are
 *   `() => import(...)` thunks and this module owns their resolution.
 *
 * Key decisions:
 *   - FULFILLED results only are cached. A rejection is evicted before it
 *     propagates, so the next mount re-invokes the thunk (D4:
 *     retry-on-next-mount). The chunk is local disk inside the app bundle, so
 *     a failure here is transient by construction; sticky failure would turn
 *     one bad read into a dead editor surface until the user quits.
 *   - In-flight promises are tracked, not just resolved values. Two panes
 *     mounting the same format in the same tick must produce ONE evaluation;
 *     an `if (!cached)` cache evaluates twice and can hand back two different
 *     module instances.
 *   - A synchronous throw inside a thunk is normalized to the same rejection
 *     as an async one — a caller must not have to handle two shapes.
 *   - Failures are typed (`FormatSurfaceLoadError`) and name both the adapter
 *     and the surface, because the mount path renders them: the invariant is
 *     "observable error surface, never a silent blank editor".
 *
 * @coordinates-with lib/formats/types.ts — the thunk types this resolves
 * @coordinates-with components/Editor/FormatSurface.tsx — the mount path + error surface
 * @module lib/formats/lazySurfaces
 */

/** Which `FormatConfig` field a resolution belongs to. */
export type FormatSurfaceKind = "wysiwygComponent" | "language";

/**
 * A format surface could not be loaded. Carries the adapter id and the field
 * so the mount path can say WHICH surface of WHICH format failed instead of
 * rendering an empty editor.
 */
export class FormatSurfaceLoadError extends Error {
  readonly formatId: string;
  readonly surface: FormatSurfaceKind;

  constructor(formatId: string, surface: FormatSurfaceKind, cause: unknown) {
    super(`[formats] "${formatId}" failed to load its ${surface}`, { cause });
    this.name = "FormatSurfaceLoadError";
    this.formatId = formatId;
    this.surface = surface;
  }
}

/** key → resolved value. Only ever written on fulfilment (D4). */
const resolved = new Map<string, unknown>();
/** key → the single in-flight attempt. Deleted on settle, either way. */
const inFlight = new Map<string, Promise<unknown>>();

function cacheKey(formatId: string, surface: FormatSurfaceKind): string {
  return `${formatId}:${surface}`;
}

/**
 * Resolve a format surface thunk, once.
 *
 * Repeat calls after success return the cached reference; overlapping calls
 * share one evaluation; a failure rejects with `FormatSurfaceLoadError` and
 * leaves nothing cached, so the next call retries (D4).
 */
export function resolveFormatSurface<T>(
  formatId: string,
  surface: FormatSurfaceKind,
  thunk: () => Promise<T>,
): Promise<T> {
  const key = cacheKey(formatId, surface);

  if (resolved.has(key)) {
    return Promise.resolve(resolved.get(key) as T);
  }
  const pending = inFlight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  // `Promise.resolve().then(thunk)` would defer the first evaluation by a
  // microtask, which loses the "one evaluation for two synchronous callers"
  // guarantee for a caller that awaits nothing. Invoke eagerly and normalize a
  // synchronous throw into the same rejection shape.
  let attempt: Promise<T>;
  try {
    attempt = Promise.resolve(thunk());
  } catch (error) {
    return Promise.reject(new FormatSurfaceLoadError(formatId, surface, error));
  }

  const tracked = attempt.then(
    (value) => {
      resolved.set(key, value);
      inFlight.delete(key);
      return value;
    },
    (error: unknown) => {
      // Evict FIRST: the next mount must find no trace of this attempt.
      inFlight.delete(key);
      throw new FormatSurfaceLoadError(formatId, surface, error);
    },
  );
  inFlight.set(key, tracked);
  return tracked;
}

/**
 * Drop every cached and in-flight resolution.
 *
 * Test-only in practice, but not `__`-prefixed by accident: production calls
 * it from nowhere, and a runtime caller that wanted to force a reload would be
 * fighting the cache rather than using it.
 */
export function __resetFormatSurfaceCache(): void {
  resolved.clear();
  inFlight.clear();
}
