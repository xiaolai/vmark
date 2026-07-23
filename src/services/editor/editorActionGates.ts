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
 * - non-document (browser) active tab: nothing is allowed. Every registry action
 *   is an editor action, and the editor store can still hold the editor of the
 *   tab the user came from — so failing OPEN would mutate a hidden document.
 * - edit / selection / lines: universal text-editor concerns; always allowed.
 * - any unknown / future category: allowed (failure-open lets new categories
 *   ship without a coordinated executor edit).
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
    // Store lookup broke — stay permissive (matches pre-WI-1A.7 behavior).
    return true;
  }
  // Positively-identified non-document tab → fail closed.
  if (tab && tab.kind !== "document") return false;

  if (
    actionDef.category === "edit" ||
    actionDef.category === "selection" ||
    actionDef.category === "lines"
  ) {
    return true;
  }
  const formatConfig: FormatConfig | undefined = tab
    ? getFormatById(tab.formatId)
    : undefined;
  /* v8 ignore next -- @preserve format unresolved → permissive (matches pre-WI-1A.7 behavior) */
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
