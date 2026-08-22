/**
 * Tab-activation pub/sub (WI-2, ADR-1 reverse reconciliation).
 *
 * tabStore announces EVERY activation — createTab, createTransferredTab,
 * setActiveTab, and the post-close/detach neighbor pick — after its state
 * write. paneStore subscribes to converge an enabled split (decision D2 in
 * .claude/tdd-guardian/decisions-20260803.md: focus FOLLOWS a tab already
 * shown in the other pane; an unpaned document lands in the focused pane;
 * browser tabs never touch panes), then DEV-asserts the ADR-1 invariant.
 * This inverts the old "route through activateTabInFocusedPane" call-site
 * convention (honored at ~5 of ~31 sites) into one seam no caller can skip.
 *
 * `tabId` is null when an activation cleared the alias (last tab closed).
 *
 * Leaf module — the same cycle-breaking shape as tabRemovalBus: imported by
 * both stores so tabStore never imports paneStore (dep-cruiser forbids store
 * cycles).
 *
 * @coordinates-with stores/tabStore.ts — emits after every activation
 * @coordinates-with stores/paneStore.ts — subscribes to converge the split
 * @module stores/tabActivationBus
 */

/**
 * Why an activation happened (WI-TNAV0.2).
 *
 * `paneStore` converges the split for every origin — a restored or
 * background-opened tab still belongs in a pane. An MRU, by contrast, must
 * record only what a human actually looked at:
 *
 *   - `user`       — a real activation: a click, a shortcut, a command.
 *   - `restore`    — session/hot-exit rehydration. Restore activates each tab
 *                    as it recreates it, so treating these as user activations
 *                    fabricates a history the user never produced.
 *   - `background` — a programmatic activation the user never saw. MCP opens
 *                    are the standing case: `workspaceOpen` deliberately
 *                    activates a tab and then restores the previous one.
 *
 * `user` is the default so every existing call site keeps its exact behaviour.
 */
export type ActivationOrigin = "user" | "restore" | "background";

type TabActivatedListener = (
  windowLabel: string,
  tabId: string | null,
  origin: ActivationOrigin,
) => void;

const listeners = new Set<TabActivatedListener>();

/** Subscribe to tab activation. Returns an unsubscribe function. */
export function onTabActivated(listener: TabActivatedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Fire all listeners for an activation (called by tabStore after its write).
 *
 * EVERY store write that changes `activeTabId` must reach this function.
 * `createBrowserTab` and `createBrowserPage` did not until WI-TNAV0.1, and the
 * cost was invisible in both directions: no MRU could see a browser
 * activation, and `paneStore`'s split convergence silently skipped them too.
 * `tabActivationBus.test.ts` classifies every tabStore action so a new one
 * cannot be added without deciding which side of this line it falls on.
 */
let scopedOrigin: ActivationOrigin | null = null;

/**
 * Run `fn` with every activation it causes announced under `origin`.
 *
 * The alternative — an `origin` parameter on `createTab`/`setActiveTab` — was
 * not available: `tabStore.ts` sits exactly on its file-size baseline, and
 * threading a parameter through five call sites to serve two callers is worse
 * anyway. Announcements happen INSIDE the store action, so the caller has no
 * other way to label them.
 *
 * **`fn` must be synchronous.** The scope is a module-level variable, so an
 * `await` inside would leak the origin onto any activation that interleaved —
 * mislabelling a genuine user action as background. That is why hot-exit
 * restore does NOT use this (its loop awaits per tab); it collapses the MRU
 * afterwards instead. Pinned by a test.
 */
export function withActivationOrigin<T>(
  origin: ActivationOrigin,
  // Rejecting a thenable at the TYPE boundary, because the synchronous-only
  // invariant is otherwise only a comment: an `await` inside would restore the
  // previous origin at the first suspension, so every activation after it —
  // including genuine user ones from elsewhere — would be mislabelled.
  fn: () => T extends PromiseLike<unknown> ? never : T,
): T {
  const previous = scopedOrigin;
  scopedOrigin = origin;
  try {
    return fn();
  } finally {
    scopedOrigin = previous;
  }
}

export function notifyTabActivated(
  windowLabel: string,
  tabId: string | null,
  origin: ActivationOrigin = scopedOrigin ?? "user",
): void {
  for (const listener of listeners) listener(windowLabel, tabId, origin);
}
