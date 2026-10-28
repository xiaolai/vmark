/**
 * Write target — what a bridge write saw when it was accepted, and the
 * re-verify that runs after the journal's prepare ack: has the user
 * edited, closed, started composing in, or moved the selection of the
 * document since?
 *
 * Key decisions:
 *   - The capture is itself a check. The handler's guards awaited, so the
 *     tab may have been edited, closed or moved to another journal document
 *     (a Save As or rename) since they read it: the capture flushes and
 *     refuses `closed` / `edited` before anything is prepared, rather than
 *     preparing a stale preimage, a key made up for a tab that is gone, or
 *     a key the guards never saw.
 *   - The same identity-and-content check (`recheckWriteTarget`) runs again
 *     after any await between the capture and the prepare, so the prepare's
 *     preimage and key are the tab's as they are when it is sent.
 *   - The re-verify flushes the mounted editors first, so keystrokes
 *     still pending in the editor count as an edit.
 *   - `closed`: the tab or its document is gone, or the tab now holds
 *     another journal document (a Save As or rename moved its key: the
 *     write was prepared against the old one). `edited`: the buffer or
 *     its revision changed. `composing`: a live editor showing the tab
 *     (WYSIWYG or Source) has an IME composition in progress or in its
 *     grace (the same check that answers BUSY before a write). `selection`: the live editor's
 *     selection the write captured moved, or its editor went away, while the
 *     tab stayed focused; or — for a write that requires focus (it named
 *     no tab, or edits the selection) — the focused tab is no longer the
 *     one the write resolved to. A write captured with no live selection (no
 *     editor showed the tab yet, or the tab was not focused) is not
 *     aborted when an editor mounts or the user switches to the tab: that
 *     is not a selection the user moved. Nor is one captured while the
 *     editor was still mounting — before its content load, or before its
 *     mount/show caret restore ran: the restore moving the caret is not the
 *     user either. Any other
 *     explicit-target write to a tab the user switched away from goes
 *     ahead: it no longer touches what the user is doing.
 *   - Synchronous, so the caller can apply in the same task with nothing
 *     the user does landing in between.
 *
 * @coordinates-with liveEditor.ts — the flush and the composition check
 * @coordinates-with selectionSurface.ts — the live selection
 * @coordinates-with documentWrite.ts — the caller
 * @module services/mcpBridge/v2/writeTarget
 */

import type { AbortReason } from "@/services/agentJournal/journalClient";
import { docKeyFor } from "@/services/agentJournal/documentIdentity";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { flushLiveEditors, liveCompositionRefusal } from "./liveEditor";
import { resolveSelectionSurface } from "./selectionSurface";

export interface WriteTarget {
  tabId: string;
  /** The window holding the tab (an untitled document's journal key names it). */
  windowLabel: string;
  /** The write must stay on the focused tab (it named none, or edits the selection). */
  requireFocus: boolean;
  /** The journal document the tab held when the write was accepted. */
  docKey: string;
  content: string;
  revision: string;
  selection: string | null;
}

function focusedTabId(): string | null {
  return useTabStore.getState().activeTabId[getCurrentWindowLabel()] ?? null;
}

/**
 * The live editor's selection on `tabId`, as a comparable key; `null` when
 * none is showing it, or the one showing it is still mounting (its caret is
 * not yet the reader's).
 */
function selectionKey(tabId: string): string | null {
  if (focusedTabId() !== tabId) return null;
  const surface = resolveSelectionSurface(tabId);
  if ("error" in surface || surface.mounting()) return null;
  const { from, to } = surface.range();
  return `${surface.mode}:${from}-${to}`;
}

function windowOf(tabId: string): string | null {
  const entry = Object.entries(useTabStore.getState().tabs).find(([, list]) => list.some((t) => t.id === tabId));
  return entry?.[0] ?? null;
}

/** The journal key of the document tab `tabId` holds now, `null` once it is closed. */
function liveDocKey(tabId: string, windowLabel: string): string | null {
  const doc = useDocumentStore.getState().documents[tabId];
  return doc ? docKeyFor({ tabId, filePath: doc.filePath }, windowLabel) : null;
}

/**
 * Capture the target of a write its guards accepted, or why it must not be
 * prepared: the tab (as the guards saw it) was closed or now holds another
 * journal document, or was edited — its buffer is no longer `content` or its
 * revision moved — in the meantime.
 */
export function captureWriteTarget(
  tab: { tabId: string; revision: string; filePath: string | null },
  requireFocus: boolean,
  content: string,
): WriteTarget | { refused: AbortReason } {
  flushLiveEditors(tab.tabId);
  const { tabId } = tab;
  const doc = useDocumentStore.getState().documents[tabId];
  const windowLabel = windowOf(tabId);
  if (!doc || windowLabel === null) return { refused: "closed" };
  const docKey = docKeyFor({ tabId, filePath: tab.filePath }, windowLabel);
  if (liveDocKey(tabId, windowLabel) !== docKey) return { refused: "closed" };
  const revision = useRevisionStore.getState().getRevision(tabId);
  if (doc.content !== content || revision !== tab.revision) return { refused: "edited" };
  return { tabId, windowLabel, requireFocus, docKey, content, revision, selection: selectionKey(tabId) };
}

/**
 * Whether the tab still holds the target's journal document with the
 * target's buffer and revision: `closed` / `edited` when not, else `null`.
 * Flushes first.
 */
export function recheckWriteTarget(target: WriteTarget): AbortReason | null {
  flushLiveEditors(target.tabId);
  const doc = useDocumentStore.getState().documents[target.tabId];
  if (!doc || windowOf(target.tabId) === null) return "closed";
  if (liveDocKey(target.tabId, target.windowLabel) !== target.docKey) return "closed";
  if (doc.content !== target.content || useRevisionStore.getState().getRevision(target.tabId) !== target.revision) {
    return "edited";
  }
  return null;
}

/** Why the write must not go ahead now, or `null` when nothing changed. */
export function reverifyWriteTarget(target: WriteTarget): AbortReason | null {
  const changed = recheckWriteTarget(target);
  if (changed) return changed;
  if (liveCompositionRefusal(target.tabId)) return "composing";
  const focused = focusedTabId() === target.tabId;
  if (target.requireFocus && !focused) return "selection";
  // Only a selection the write saw can have moved: one captured as `null` (no
  // live editor showed the tab, it was still mounting, or the tab was not
  // focused) is not the user's selection moving when an editor mounts and
  // restores its caret or the user switches to the tab.
  if (focused && target.selection !== null && selectionKey(target.tabId) !== target.selection) return "selection";
  return null;
}
