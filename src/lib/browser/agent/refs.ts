/**
 * Stable element refs backed by a per-document store (WI-P2.1, ADR-A2).
 *
 * Purpose: each snapshotted element gets a monotonic ref (`e1`, `e2`, …) that is
 * STABLE across repeated reads within one committed page, so `act` can target
 * `{ref}` exactly instead of re-resolving a fuzzy role + accessible name (the
 * ambiguity that made a live "More information…"/"Learn more" act a silent no-op).
 *
 * The store lives on the `document`, which gives it exactly the right lifecycle:
 * it persists across reads within a page, and resets when a navigation replaces
 * the document (the isolated content world is torn down with it), so a ref cannot
 * leak across pages. Belt-and-suspenders: `act` also carries the navigation
 * `generation`, so the Rust freshness gate rejects a ref minted on an old page
 * regardless — authorization is never by ref, only ever by committed origin +
 * operation.
 *
 * The injected copy in `actScript.ts` mirrors this exactly (same
 * `document.__vmarkRefStore` shape and assignment order), so the two
 * implementations agree; `actScript.test.ts` is the contract that keeps them
 * honest. Leaf-pure DOM logic — no store, no Tauri — so it is jsdom-unit-testable
 * and can also run verbatim in the driver's isolated world.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — the injected mirror
 * @coordinates-with lib/browser/agent/aria.ts — ariaSnapshot stamps each node with its ref
 * @module lib/browser/agent/refs
 */

interface RefStore {
  /** element → ref, so a repeated read returns the same ref. */
  refs: WeakMap<Element, string>;
  /** ref → element (weakly), so `act` can resolve a handle back to a node without
   *  pinning a detached subtree alive for the life of the document — a long-lived
   *  SPA that swaps controls would otherwise accumulate them indefinitely. */
  byRef: Map<string, WeakRef<Element>>;
  /** Monotonic counter — the next ref is `e${n + 1}`. */
  n: number;
}

type DocWithStore = Document & { __vmarkRefStore?: RefStore };

/** Get (or lazily create) the ref store bound to `doc`. */
function storeFor(doc: Document): RefStore {
  const holder = doc as DocWithStore;
  if (!holder.__vmarkRefStore) {
    holder.__vmarkRefStore = { refs: new WeakMap(), byRef: new Map(), n: 0 };
  }
  return holder.__vmarkRefStore;
}

/** The stable ref for `el`, assigning a fresh one on first sight. Returns "" for
 *  a detached element with no owner document (nothing to key a store on). */
export function refFor(el: Element): string {
  const doc = el.ownerDocument;
  if (!doc) return "";
  const store = storeFor(doc);
  const existing = store.refs.get(el);
  if (existing) return existing;
  const ref = `e${(store.n += 1)}`;
  store.refs.set(el, ref);
  store.byRef.set(ref, new WeakRef(el));
  return ref;
}

/** Resolve a ref back to its element, or null if the ref is unknown to this
 *  document, its element has been garbage-collected or left the DOM, or it has
 *  been adopted into another document (whose store must own it, not this one).
 *  A stale handle is never acted on. */
export function queryByRef(doc: Document, ref: string): Element | null {
  const el = storeFor(doc).byRef.get(ref)?.deref();
  if (!el || !el.isConnected || el.ownerDocument !== doc) return null;
  return el;
}
