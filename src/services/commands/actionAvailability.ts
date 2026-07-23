/**
 * Command availability policy
 *
 * Purpose: the single, typed predicate over the resolved command context that
 *   decides whether an editor action may run / be offered. Two layers:
 *
 *   - `isActionExecutable` — the EXECUTOR's correctness gate: live document tab,
 *     mode capability, and per-format policy. It deliberately omits
 *     editor-mounted and node/selection checks: `runEditorAction`'s retry handles
 *     a not-yet-mounted editor, and the adapters no-op node-specific ops, so
 *     requiring node context here would fight the menu's own context gating.
 *   - `actionAvailability` — the PALETTE's `when`: everything executable PLUS an
 *     editor is mounted and the action's node / selection requirements are met.
 *
 * This is a closed structured record evaluated by one typed function — NOT a
 * serialized predicate DSL: VMark's actions are first-party compiled TS, so a
 * data DSL would add a parser and type-drift for zero current consumer
 * (ADR-017 / command-registry WI-2.2, Zed-cross-checked).
 *
 * @coordinates-with commandContext.ts — the resolved context this reads
 * @coordinates-with editor/editorActionGates.ts — per-format category policy
 * @module services/commands/actionAvailability
 */

import type { ActionId } from "@/plugins/actions/types";
import { ACTION_DEFINITIONS } from "@/plugins/actions/actionRegistry";
import { isCategoryAllowedByFormat, mapActionIdToAdapterAction } from "@/services/editor/editorActionGates";
import { LINK_DISABLED_ACTIONS } from "@/plugins/toolbarActions/enableRules";
import { getMultiSelectionPolicyForAction } from "@/plugins/toolbarActions/multiSelectionPolicy";
import type { CommandContextResolved } from "./commandContext";

/**
 * Actions that BYPASS the adapters' multi-selection gate, so multi-selection
 * never disables them:
 *  - undo/redo route through unified history in `runEditorAction`, before any
 *    adapter dispatch;
 *  - setHeading/paragraph are evaluated by the adapters as `heading:N`
 *    ("conditional"), not by their ActionId (whose adapter name is unlisted).
 */
const MULTI_SELECT_GATE_BYPASS: ReadonlySet<ActionId> = new Set([
  "undo",
  "redo",
  "setHeading",
  "paragraph",
]);

/**
 * True when multi-selection disables an action. Reuses the SAME predicate the
 * WYSIWYG and Source adapters apply — `getMultiSelectionPolicyForAction`, keyed
 * by the adapter action name, defaulting unlisted actions to "disallow" — so the
 * palette hides exactly what the adapters would reject, except:
 *  - the bypass actions above are never hidden.
 *
 * Two residual approximations remain, both requiring the FULL per-cursor
 * multi-selection context that the flattened palette context does not carry, and
 * both deferred to Phase 3 (per-spec projection + reactive context). Neither is a
 * correctness risk — the adapters' `canRunActionInMultiSelection` is the final
 * boundary, so a shown-but-rejected action is a harmless no-op, never a wrong edit:
 *  1. "conditional" actions (lists, blockquote nesting) are shown even though the
 *     adapter rejects them unless all cursors share a structural context;
 *  2. `canRunActionInMultiSelection` also vetoes EVERY multi-selection action
 *     (including policy-"allow" marks) when any range is inside a code block,
 *     table, link, image, inline math, or footnote — the palette does not
 *     reproduce these universal context vetoes.
 */
function isHiddenUnderMultiSelection(id: ActionId): boolean {
  if (MULTI_SELECT_GATE_BYPASS.has(id)) return false;
  return getMultiSelectionPolicyForAction(mapActionIdToAdapterAction(id)) === "disallow";
}

type NodeAxis = "table" | "link" | "list" | "blockquote" | "codeBlock" | "heading";

interface AvailabilityDescriptor {
  /** Cursor must be inside ANY of these node contexts. */
  requiresNode?: readonly NodeAxis[];
  /** A non-empty selection is required. */
  requiresSelection?: boolean;
}

/**
 * Actions with node / selection requirements. Everything NOT listed is available
 * wherever its mode + format permit it (no positional requirement).
 */
const ACTION_AVAILABILITY: Partial<Record<ActionId, AvailabilityDescriptor>> = {
  // Table-cell actions require the cursor to be inside a table (insertTable does
  // not — it creates one).
  addRowAbove: { requiresNode: ["table"] },
  addRowBelow: { requiresNode: ["table"] },
  addColLeft: { requiresNode: ["table"] },
  addColRight: { requiresNode: ["table"] },
  deleteRow: { requiresNode: ["table"] },
  deleteCol: { requiresNode: ["table"] },
  deleteTable: { requiresNode: ["table"] },
  alignLeft: { requiresNode: ["table"] },
  alignCenter: { requiresNode: ["table"] },
  alignRight: { requiresNode: ["table"] },
  alignAllLeft: { requiresNode: ["table"] },
  alignAllCenter: { requiresNode: ["table"] },
  alignAllRight: { requiresNode: ["table"] },
  formatTable: { requiresNode: ["table"] },
  // Blockquote nesting requires being inside a blockquote (the toggle does not).
  nestBlockquote: { requiresNode: ["blockquote"] },
  unnestBlockquote: { requiresNode: ["blockquote"] },
  removeBlockquote: { requiresNode: ["blockquote"] },
  // List indent/outdent + removal require being in a list (toolbar enabledIn).
  indent: { requiresNode: ["list"] },
  outdent: { requiresNode: ["list"] },
  removeList: { requiresNode: ["list"] },
  // Clearing formatting needs a selection to act on.
  clearFormatting: { requiresSelection: true },
};

/**
 * Selection / navigation actions that do NOT change document content. Phase 2b
 * keeps these available under read-only while hiding the mutating ones.
 */
const NON_MUTATING: ReadonlySet<ActionId> = new Set<ActionId>([
  "selectWord",
  "selectLine",
  "selectBlock",
  "expandSelection",
]);

/** Whether an action changes document content (for the Phase 2b read-only gate). */
export function mutatesDocument(id: ActionId): boolean {
  return !NON_MUTATING.has(id);
}

function hasNode(ctx: CommandContextResolved, axis: NodeAxis): boolean {
  switch (axis) {
    case "table":
      return ctx.inTable;
    case "link":
      return ctx.inLink;
    case "list":
      return ctx.inList;
    case "blockquote":
      return ctx.inBlockquote;
    case "codeBlock":
      return ctx.inCodeBlock;
    case "heading":
      return ctx.inHeading;
  }
}

/**
 * The executor's correctness gate: live document + mode capability + format
 * policy. NO editor-mounted check (the retry handles that) and NO node/selection
 * check (the adapters no-op those). This is the single source the executor and
 * the palette availability both build on.
 */
export function isActionExecutable(id: ActionId, ctx: CommandContextResolved): boolean {
  if (!ctx.isDocument) return false;
  const def = ACTION_DEFINITIONS[id];
  if (!def) return false;
  if (ctx.mode === "source" ? !def.supports.source : !def.supports.wysiwyg) return false;
  return isCategoryAllowedByFormat(def.category, ctx.formatId);
}

/**
 * The palette's availability predicate (a command's `when`): everything
 * `isActionExecutable` requires, plus a mounted editor and the action's node /
 * selection requirements.
 */
export function actionAvailability(id: ActionId, ctx: CommandContextResolved): boolean {
  if (!isActionExecutable(id, ctx)) return false;
  if (!ctx.editorAvailable) return false;

  // Link context: reuse the exact LINK_DISABLED_ACTIONS set (keyed by adapter
  // name) so the palette matches the toolbar/keymap for in-link actions.
  const adapterAction = mapActionIdToAdapterAction(id);
  if (ctx.inLink && LINK_DISABLED_ACTIONS.has(adapterAction)) return false;
  // Multi-selection: hide what the adapters' own multi-selection gate rejects.
  if (ctx.multiSelection && isHiddenUnderMultiSelection(id)) return false;

  const req = ACTION_AVAILABILITY[id];
  if (!req) return true;
  // A selection requirement is met by the primary selection OR any multi-cursor
  // range (multi-selection actions such as clearFormatting are policy-"allow").
  if (req.requiresSelection && !ctx.hasSelection && !ctx.multiSelection) return false;
  if (req.requiresNode && !req.requiresNode.some((axis) => hasNode(ctx, axis))) return false;
  return true;
}
