/**
 * Purpose: the document context a plugin edits in — which file, which vault
 * root, and whether the buffer has unsaved changes.
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
 * `activeFilePathForCurrentWindow()` at the foot of this file is the guarded
 * convenience all eight use; see its comment for why the guard lives in one
 * place rather than at each call site.
 *
 * A plugin importing this depends on an interface with a working default
 * (`null` — no document, so nothing to resolve against), not on the app's
 * Zustand singletons, so it still runs when lifted out of this repo.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @coordinates-with plugins/shared/hostSettings.ts — the sibling seam
 * @module plugins/shared/hostDocument
 */

import type { HardBreakStyle } from "@/utils/linebreakDetection";
import type { CursorInfo } from "@/types/cursorSync";
import { getWindowLabel } from "@/services/navigation/windowFocus";

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
  reportCursorInfo: (windowLabel: string, info: CursorInfo) => void;
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
  /**
   * Absolute path of the open workspace root, or null when none is open.
   *
   * Wiki links resolve against it: `[[notes/todo]]` means nothing without
   * knowing where the vault starts. Null is a real answer — a single file
   * opened outside any workspace has no root, and the resolver already
   * treats that as "cannot resolve".
   */
  workspaceRoot: () => string | null;
  /**
   * The format id of the active tab in `windowLabel`, or null.
   *
   * A plugin that adapts its UI per file type needs to know WHICH type; what
   * that type permits it looks up itself, in `lib/formats`. Null means "no
   * document, or not a document tab", and callers read it as "no
   * restrictions" — the permissive answer, matching the menu dispatcher.
   */
  activeFormatId: (windowLabel: string) => string | null;
  /** Full markdown of the active document, or "" when there is none. */
  activeContent: (windowLabel: string) => string;
  /**
   * The hard-break spelling detected in the active document.
   *
   * "unknown" is the honest default: a fresh buffer has no evidence either
   * way, and the resolver already treats it as "fall back to the setting".
   */
  activeHardBreakStyle: (windowLabel: string) => HardBreakStyle;
  /**
   * Record an undo checkpoint for the active document.
   *
   * A WRITE, like `reportCursorInfo`, and shaped the same way: the plugin
   * knows it is about to make a change worth undoing as one step; the host
   * decides what a checkpoint means.
   */
  checkpoint: (
    windowLabel: string,
    snapshot: { markdown: string; mode: "source" | "wysiwyg" }
  ) => void;
}

/** No document — the honest answer when no host has bound anything. */
const DEFAULTS: HostDocument = {
  activeFilePath: () => null,
  reportCursorInfo: () => {},
  isTabDirty: () => false,
  workspaceRoot: () => null,
  activeFormatId: () => null,
  activeContent: () => "",
  activeHardBreakStyle: () => "unknown",
  checkpoint: () => {},
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
  workspaceRoot: () => bound.workspaceRoot(),
  activeFormatId: (windowLabel) => bound.activeFormatId(windowLabel),
  activeContent: (windowLabel) => bound.activeContent(windowLabel),
  activeHardBreakStyle: (windowLabel) => bound.activeHardBreakStyle(windowLabel),
  checkpoint: (windowLabel, snapshot) => bound.checkpoint(windowLabel, snapshot),
};

/**
 * The active document's path for the CURRENT window, or null.
 *
 * A guarded convenience over `activeFilePath`, not a seam member: it calls
 * `getWindowLabel()`, which reads the Tauri window and THROWS outside a Tauri
 * context. Eight plugin files need this; six had each hand-rolled the same
 * try/catch and two had not, so a copy-resolution handler could reject
 * instead of falling back. One guard here makes that unrepeatable.
 *
 * The pre-seam helper this replaces (`getActiveTabIdForCurrentWindow`) had
 * exactly this guard — losing it is what the audit caught, twice.
 */
export function activeFilePathForCurrentWindow(): string | null {
  let windowLabel: string;
  try {
    windowLabel = getWindowLabel();
  } catch {
    // Only the LABEL lookup is guarded. A wider try would also swallow a
    // failure inside the host's binding, which several callers wrap in their
    // own try/catch precisely so they can log it.
    return null;
  }
  return hostDocument.activeFilePath(windowLabel);
}
