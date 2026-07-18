/**
 * Lint doc-epoch guard.
 *
 * Purpose: prevents an in-flight async lint completion (the link check) from
 * repainting STALE diagnostics onto a document that changed while the check
 * was running. Editing clears lint decorations, but a link-check Promise that
 * resolves afterwards updates the store and triggers a rebuild that would map
 * old line numbers onto the edited doc.
 *
 * Pipeline: lint plugin apply() bumps the per-tab doc epoch on every doc
 * change → runActiveLint snapshots the epoch when it captures the content it
 * lints → the plugin drops any diagnostics rebuild whose snapshot no longer
 * matches the current epoch.
 *
 * Key decisions:
 *   - A tab with NO recorded run start is always "current": lint runs that
 *     don't go through runActiveLint keep today's behavior.
 *   - Module-level maps (not zustand state): plumbing, not UI state.
 *
 * @coordinates-with tiptap.ts — bumps the epoch and enforces the guard
 * @coordinates-with services/lint/runActiveLint.ts — marks the run start
 * @module plugins/lint/docEpoch
 */

/** Per-tab count of document changes seen by the WYSIWYG lint plugin. */
const docEpochs = new Map<string, number>();

/** Per-tab doc epoch snapshot taken when the last lint run captured its content. */
const runEpochs = new Map<string, number>();

/** Record a document change for the tab (called from the plugin's apply()). */
export function bumpLintDocEpoch(tabId: string): void {
  docEpochs.set(tabId, (docEpochs.get(tabId) ?? 0) + 1);
}

/** Snapshot the tab's doc epoch at the moment lint content is captured. */
export function markLintRunStart(tabId: string): void {
  runEpochs.set(tabId, docEpochs.get(tabId) ?? 0);
}

/**
 * True when the tab's document has not changed since the recorded lint run
 * started — or when no run was ever recorded for the tab.
 */
export function isLintRunCurrent(tabId: string): boolean {
  const started = runEpochs.get(tabId);
  return started === undefined || started === (docEpochs.get(tabId) ?? 0);
}
