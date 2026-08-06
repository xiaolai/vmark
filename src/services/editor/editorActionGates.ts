/**
 * Editor-action policy + resolution helpers
 *
 * Purpose: the pure, format-aware decisions the availability layer and the
 *   executor share — whether the active format permits an action's category,
 *   what the effective editing surface is, and the adapter-action-name mapping.
 *   Invocation-source agnostic, so the menu and the palette gate alike.
 *
 * The document-tab gate (fail closed without a live document) now lives in
 * `commandContext.resolveCommandContext` (`ctx.isDocument`); this module only
 * answers the per-format category question.
 *
 * @coordinates-with lib/formats/registry.ts — menuPolicy gating
 * @coordinates-with commands/actionAvailability.ts — consumes these
 * @module services/editor/editorActionGates
 */

import { useUIStore } from "@/stores/uiStore";
import { selectSourceEditing } from "@/stores/selectSourceEditing";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import type { ActionCategory, ActionId } from "@/plugins/actions/types";
import type { AdapterAction } from "@/plugins/toolbarActions/adapterActions";
import { getFormatById } from "@/lib/formats/registry";
import type { FormatConfig } from "@/lib/formats/types";

/**
 * Whether the active format permits an action of the given category, via the
 * per-format `menuPolicy`. Assumes a live document tab (the document gate is
 * `ctx.isDocument`, checked separately).
 *
 * - edit / selection / lines: universal text-editor concerns; always allowed.
 * - a document tab whose format config is unknown → allowed (WI-1A.7: a new /
 *   non-markdown format ships without a coordinated edit here).
 * - unrecognised future categories → allowed.
 */
export function isCategoryAllowedByFormat(
  category: ActionCategory,
  formatId: string | null,
): boolean {
  if (category === "edit" || category === "selection" || category === "lines") {
    return true;
  }
  const formatConfig: FormatConfig | undefined = formatId
    ? getFormatById(formatId)
    : undefined;
  /* v8 ignore next -- @preserve document tab, unknown format → permissive (WI-1A.7) */
  if (!formatConfig) return true;
  const policy = formatConfig.adapters.menuPolicy;
  switch (category) {
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

/**
 * Map action IDs to the internal adapter action names where they differ.
 * The two parameterized heading actions are excluded from the domain: they
 * carry a level and are dispatched through `setWysiwygHeadingLevel` BEFORE
 * any adapter mapping (both dispatch paths branch on them first, which is
 * exactly the control-flow narrowing this signature encodes).
 */
export function mapActionIdToAdapterAction(
  actionId: Exclude<ActionId, "setHeading" | "paragraph">
): AdapterAction {
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
