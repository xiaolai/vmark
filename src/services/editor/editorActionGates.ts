/**
 * Editor-action policy + resolution helpers
 *
 * Purpose: the pure, store-driven decisions the executor consults before it
 *   dispatches — is the action allowed for the active tab's format, what is the
 *   effective editing surface, and the adapter-action-name mapping. Split out of
 *   `runEditorAction.ts` to keep each module focused (and under the size gate);
 *   these are invocation-source agnostic, so the menu and the palette gate alike.
 *
 * @coordinates-with lib/formats/registry.ts — menuPolicy gating
 * @coordinates-with runEditorAction.ts — the executor that consults these
 * @module services/editor/editorActionGates
 */

import { useUIStore } from "@/stores/uiStore";
import { selectSourceEditing } from "@/stores/selectSourceEditing";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStoreTypes";
import type { ActionDefinition, ActionId } from "@/plugins/actions/types";
import { getFormatById } from "@/lib/formats/registry";
import type { FormatConfig } from "@/lib/formats/types";

/**
 * Map an ActionDefinition's category to the per-format menuPolicy field that
 * gates it. Returns true when the active tab permits the action.
 *
 * The action REQUIRES a positively-identified document tab. No active tab (all
 * tabs closed), a dangling id, a non-document (browser) tab, or a broken store
 * lookup all fail CLOSED: the editor store can still hold the editor of a
 * previously-active tab, so failing open would let an action — including
 * undo/redo — mutate a hidden document the user is no longer looking at.
 *
 * The only failure-OPEN case is an explicitly-identified document tab whose
 * format config is unknown (WI-1A.7: a new/non-markdown format ships without a
 * coordinated edit here), plus universal edit/selection/lines categories and
 * unrecognised future categories on such a tab.
 */
export function isActionAllowedForActiveFormat(
  actionDef: ActionDefinition,
  windowLabel: string,
): boolean {
  let tab: Tab | null;
  try {
    const activeTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    tab = activeTabId ? useTabStore.getState().findTabById(activeTabId) : null;
    /* v8 ignore next 4 -- @preserve defensive lookup; tests with stub tabStore exercise the happy path */
  } catch {
    // Store lookup broke — no confirmed document → fail closed.
    return false;
  }
  // No live document tab (missing/dangling id or a non-document tab) → fail
  // closed, so a retained editor is never mutated without an active document.
  if (!tab || tab.kind !== "document") return false;

  if (
    actionDef.category === "edit" ||
    actionDef.category === "selection" ||
    actionDef.category === "lines"
  ) {
    return true;
  }
  const formatConfig: FormatConfig | undefined = getFormatById(tab.formatId);
  /* v8 ignore next -- @preserve document tab, unknown format → permissive (WI-1A.7) */
  if (!formatConfig) return true;
  const policy = formatConfig.adapters.menuPolicy;
  switch (actionDef.category) {
    case "formatting":
    case "headings":
    case "lists":
    case "blockquote":
      return policy.paragraphFormatting;
    case "codeBlock":
    case "tables":
    case "inserts":
    case "links":
      return policy.insertBlockActions;
    case "cjk":
    case "cleanup":
    case "transform":
      return policy.cjkFormatActions;
    default:
      return true;
  }
}

/**
 * The effective editing surface: the window-global source mode OR-ed with the
 * active tab's forced-source marker (large files opened in Source even when the
 * window is otherwise in WYSIWYG). The executor owns this resolution so every
 * caller agrees on the target surface.
 */
export function isEffectiveSourceMode(windowLabel: string): boolean {
  const activeTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const forcedTabSource = activeTabId
    ? useLargeFileSessionStore.getState().isForcedSource(activeTabId)
    : false;
  return selectSourceEditing(useUIStore.getState()) || forcedTabSource;
}

/** Map action IDs to the internal adapter action names where they differ. */
export function mapActionIdToAdapterAction(actionId: ActionId): string {
  switch (actionId) {
    case "codeBlock":
      return "insertCodeBlock";
    case "blockquote":
      return "insertBlockquote";
    case "horizontalLine":
      return "insertDivider";
    case "addRowBelow":
      return "addRow";
    case "addColRight":
      return "addCol";
    case "wikiLink":
      return "link:wiki";
    case "bookmark":
      return "link:bookmark";
    default:
      return actionId;
  }
}
