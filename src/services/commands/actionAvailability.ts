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
import { canRunActionInMultiSelection } from "@/plugins/toolbarActions/multiSelectionPolicy";
import type { MultiSelectionContext } from "@/plugins/toolbarActions/types";
import {
  paletteRequirementFor,
  type NodeAxis,
} from "@/plugins/toolbarActions/actionApplicability";
import type { CommandContextResolved } from "./commandContext";

/**
 * The adapter key evaluated for a palette action (multi-selection policy and
 * the in-link disabled set alike). Most actions map 1:1 via
 * `mapActionIdToAdapterAction`; the two parameterized heading actions carry
 * no level at palette time, but every `heading:N` shares one policy, so a
 * representative level yields the correct yes/no verdict (`paragraph` ==
 * level 0, `setHeading` == a heading).
 */
function adapterKeyFor(id: ActionId): string {
  if (id === "setHeading") return "heading:1";
  if (id === "paragraph") return "heading:0";
  return mapActionIdToAdapterAction(id);
}

/**
 * Whether an action survives the adapters' multi-selection gate for the given
 * context. Delegates to the SAME `canRunActionInMultiSelection` the WYSIWYG and
 * Source adapters call at execution time, so the palette offers exactly what the
 * adapter would accept — including its two context-dependent rules that a static
 * policy lookup cannot reproduce:
 *  1. the "conditional" actions (headings, lists, blockquote nesting) are gated
 *     on all cursors sharing a structural context (`sameBlockParent` +
 *     `inTextblock`); and
 *  2. the universal vetoes that disable EVERY multi-selection action (even
 *     policy-"allow" marks) when any cursor is inside a code block, table, link,
 *     image, inline math, or footnote.
 * This is why the resolved context now carries the full `MultiSelectionContext`
 * rather than a bare boolean (closes command-registry WI-2.2 residuals a/b).
 */
function isAvailableUnderMultiSelection(id: ActionId, multi: MultiSelectionContext): boolean {
  // undo/redo need no local bypass: the shared gate itself always allows
  // history under multi-selection — ONE policy, not two that can drift.
  return canRunActionInMultiSelection(adapterKeyFor(id), multi);
}

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

/**
 * Adapter-vocabulary twin of `mutatesDocument`: the four non-mutating ids map
 * 1:1 through `mapActionIdToAdapterAction` (identity cases), so ONE set backs
 * both vocabularies.
 */
export function adapterActionMutates(action: string): boolean {
  return !NON_MUTATING.has(action as ActionId);
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
      return ctx.inHeading || Boolean(ctx.multiSelection?.inHeading);
  }
}

/**
 * The executor's correctness gate: live document + mode capability + read-only +
 * format policy. NO editor-mounted check (the retry handles that) and NO
 * node/selection check (the adapters no-op those). This is the single source the
 * executor and the palette availability both build on.
 *
 * Read-only IS enforced here, not just hidden in the palette: mutating actions
 * must be refused for the MENU path too, and undo/redo bypass the editor entirely
 * (unified history), so the read-only editor is not a sufficient boundary for
 * them (Phase 2b). Non-mutating selection/navigation actions stay executable.
 */
export function isActionExecutable(id: ActionId, ctx: CommandContextResolved): boolean {
  if (!ctx.isDocument) return false;
  const def = ACTION_DEFINITIONS[id];
  if (!def) return false;
  if (ctx.mode === "source" ? !def.supports.source : !def.supports.wysiwyg) return false;
  if (ctx.readOnly && mutatesDocument(id)) return false;
  return isCategoryAllowedByFormat(def.category, ctx.formatId);
}

/**
 * The palette's availability predicate (a command's `when`): everything
 * `isActionExecutable` requires, plus a mounted editor and the action's node /
 * selection requirements.
 */
export function actionAvailability(id: ActionId, ctx: CommandContextResolved): boolean {
  // isActionExecutable already refuses mutating actions under read-only (Phase 2b).
  if (!isActionExecutable(id, ctx)) return false;
  if (!ctx.editorAvailable) return false;

  // Link context: reuse the exact LINK_DISABLED_ACTIONS set (keyed by adapter
  // name) so the palette matches the toolbar/keymap for in-link actions.
  const adapterAction = adapterKeyFor(id);
  if (ctx.inLink && LINK_DISABLED_ACTIONS.has(adapterAction)) return false;
  // Multi-selection: hide exactly what the adapters' own multi-selection gate
  // would reject for this cursor set (universal vetoes + shared-context rule).
  if (ctx.multiSelection && !isAvailableUnderMultiSelection(id, ctx.multiSelection)) return false;

  // Node/selection requirements derive from the SAME applicability table the
  // toolbar's enable rules use (single source; palette overrides documented
  // in actionApplicability.ts).
  const req = paletteRequirementFor(adapterAction);
  if (!req) return true;
  // A selection requirement is met by the primary selection OR a multi-cursor
  // set with at least one NON-EMPTY range — all-collapsed cursors would no-op.
  // hasNonEmptyRange missing means the builder predates the field — err
  // toward available (the real builders always set it).
  if (
    req.requiresSelection &&
    !ctx.hasSelection &&
    !(ctx.multiSelection && (ctx.multiSelection.hasNonEmptyRange ?? true))
  ) {
    return false;
  }
  if (req.requiresNode && !req.requiresNode.some((axis) => hasNode(ctx, axis))) return false;
  return true;
}
