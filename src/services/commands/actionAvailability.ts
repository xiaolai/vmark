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

import type { ActionCategory, ActionId } from "@/plugins/actions/types";
import { ACTION_DEFINITIONS } from "@/plugins/actions/actionRegistry";
import { isCategoryAllowedByFormat, mapActionIdToAdapterAction } from "@/services/editor/editorActionGates";
import { LINK_DISABLED_ACTIONS } from "@/plugins/toolbarActions/enableRules";
import type { CommandContextResolved } from "./commandContext";

/**
 * Categories whose actions are disallowed while multiple cursors are active —
 * every insert / table / link / code-block operation, mirroring the intent of
 * `MULTI_SELECTION_POLICY` (which "disallow"s them explicitly and defaults every
 * unlisted insert to "disallow"). Formatting marks are policy-"allow";
 * headings / lists / blockquote are "conditional" (shown; the adapter decides).
 *
 * This is a category-level APPROXIMATION of the runtime policy, not exact parity:
 * the palette cannot reproduce the per-`heading:N` conditional or the structural
 * "all cursors share a context" checks (and `setHeading`'s level is not in the
 * ActionId). The adapter's `canRunActionInMultiSelection` remains the final
 * boundary — a shown-but-rejected action is a harmless no-op, never a wrong edit.
 */
const MULTI_SELECT_DISALLOWED_CATEGORIES: ReadonlySet<ActionCategory> = new Set([
  "inserts",
  "tables",
  "links",
  "codeBlock",
]);

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
  // Multi-selection: hide the disallowed categories (approximate — see the
  // MULTI_SELECT_DISALLOWED_CATEGORIES note; the adapter is the final boundary).
  if (ctx.multiSelection && MULTI_SELECT_DISALLOWED_CATEGORIES.has(ACTION_DEFINITIONS[id].category)) {
    return false;
  }

  const req = ACTION_AVAILABILITY[id];
  if (!req) return true;
  // A selection requirement is met by the primary selection OR any multi-cursor
  // range (multi-selection actions such as clearFormatting are policy-"allow").
  if (req.requiresSelection && !ctx.hasSelection && !ctx.multiSelection) return false;
  if (req.requiresNode && !req.requiresNode.some((axis) => hasNode(ctx, axis))) return false;
  return true;
}
