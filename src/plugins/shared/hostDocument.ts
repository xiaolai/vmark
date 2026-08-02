/**
 * Purpose: the active document's identity and save state, for plugins that
 * must resolve relative paths or know whether a buffer is already dirty.
 *
 * A separate seam from `hostSettings.ts` deliberately. That one answers "what
 * did the user configure"; this answers "what document am I in". Two small,
 * honestly-named seams beat one grab-bag whose name stops describing it.
 *
 * Eight plugin files reach `useTabStore.getState().activeTabId[label]` and then
 * `useDocumentStore.getState().getDocument(tabId)?.filePath` — the same four
 * lines, for the same reason: an image `src` or a wiki link is relative to the
 * file it is written in. That is ambient editor context, not something an
 * extension option can carry to a leaf resolver.
 *
 * A plugin importing this depends on an interface with a working default
 * (`null` — no document, so nothing to resolve against), not on the app's
 * Zustand singletons, so it still runs when lifted out of this repo.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @coordinates-with plugins/shared/hostSettings.ts — the sibling seam
 * @module plugins/shared/hostDocument
 */

/** What a plugin needs to know about the document it is editing. */
export interface HostDocument {
  /**
   * Absolute path of the document in `windowLabel`, or null.
   *
   * Null is a real answer, not a failure: an untitled buffer has no path, and
   * a relative link inside one has nothing to resolve against.
   */
  activeFilePath: (windowLabel: string) => string | null;
  /**
   * Report the cursor position for the active document in `windowLabel`.
   *
   * A WRITE, unlike everything else here, and deliberately shaped as
   * "report" rather than "set a store field": the plugin knows where the
   * cursor is, the host decides what to do with that.
   */
  reportCursorInfo: (windowLabel: string, info: unknown) => void;
  /**
   * Whether the buffer for `tabId` has unsaved changes.
   *
   * Keyed by TAB, unlike the two above, because the caller already holds a
   * tab id: an AI suggestion records which buffer it targets, and accepting
   * it must know whether that buffer was already dirty before the edit.
   *
   * Defaults to false — "nothing unsaved" is the safe answer when no host is
   * bound, since the only consumer uses it to decide whether to preserve an
   * existing dirty flag.
   */
  isTabDirty: (tabId: string) => boolean;
}

/** No document — the honest answer when no host has bound anything. */
const DEFAULTS: HostDocument = {
  activeFilePath: () => null,
  reportCursorInfo: () => {},
  isTabDirty: () => false,
};

let bound: HostDocument = DEFAULTS;

/** Bind the host's document lookup. Called once, at app startup. */
export function bindHostDocument(document: Partial<HostDocument>): void {
  bound = { ...DEFAULTS, ...document };
}

/** Restore defaults. Tests only. */
export function resetHostDocument(): void {
  bound = DEFAULTS;
}

/** The bound lookup, read through an accessor so it is never captured stale. */
export const hostDocument: HostDocument = {
  activeFilePath: (windowLabel) => bound.activeFilePath(windowLabel),
  reportCursorInfo: (windowLabel, info) => bound.reportCursorInfo(windowLabel, info),
  isTabDirty: (tabId) => bound.isTabDirty(tabId),
};
