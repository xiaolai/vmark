/**
 * Editor context-menu snapshot providers.
 *
 * Purpose: capture the normalized `EditorContextMenuSnapshot` (plan
 * ADR-6) from the live editor state at right-click time. Reuses the
 * shared ToolbarContext builders (one source of truth for context
 * construction) and `getToolbarItemState` against the toolbar's own item
 * definitions, so the menu's disabled/checked states can never diverge
 * from the toolbar's.
 *
 * Format policy: reads the active tab's format adapters (markdown sets
 * both bits true; restricted formats reduce the menu to clipboard
 * items). Unresolved formats stay permissive — matching the unified
 * menu dispatcher's behavior.
 *
 * @coordinates-with tiptap.ts — WYSIWYG trigger consumes buildWysiwygSnapshot
 * @coordinates-with plugins/codemirror/editorContextMenu.ts — source trigger
 * @module plugins/editorContextMenu/snapshot
 */

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  TOOLBAR_GROUPS,
  isSeparator,
  type ToolbarActionItem,
} from "@/components/Editor/UniversalToolbar/toolbarGroups";
import { CONTEXT_MENU_DESCRIPTORS } from "@/components/Editor/EditorContextMenu/menuModel";
import { getToolbarItemState } from "@/plugins/toolbarActions/enableRules";
import { buildSourceContext, buildWysiwygContext } from "@/plugins/toolbarActions/dispatch";
import type { ToolbarContext } from "@/plugins/toolbarActions/types";
import { getFormatById } from "@/lib/formats/registry";
import { useTabStore } from "@/stores/tabStore";
import type {
  EditorContextMenuSnapshot,
  EditorMenuFormatPolicy,
} from "@/types/editorContextMenu";
import { getSourceLinkTarget } from "./sourceLinkTarget";

const TOOLBAR_ITEM_BY_ACTION: ReadonlyMap<string, ToolbarActionItem> = new Map(
  TOOLBAR_GROUPS.flatMap((group) => group.items)
    .filter((item): item is ToolbarActionItem => !isSeparator(item))
    .map((item) => [item.action, item])
);

/** Menu-policy bits for the active tab's format; permissive when the
 *  format cannot be resolved (matches the unified menu dispatcher). */
export function getActiveFormatMenuPolicy(): EditorMenuFormatPolicy {
  try {
    const windowLabel = getCurrentWebviewWindow().label;
    const tabStore = useTabStore.getState();
    const activeTabId = tabStore.activeTabId[windowLabel] ?? null;
    const tab = activeTabId ? tabStore.findTabById(activeTabId) : null;
    const format = tab ? getFormatById(tab.formatId) : undefined;
    if (!format) return { paragraphFormatting: true, insertBlockActions: true };
    return {
      paragraphFormatting: format.adapters.menuPolicy.paragraphFormatting,
      insertBlockActions: format.adapters.menuPolicy.insertBlockActions,
    };
  } catch {
    return { paragraphFormatting: true, insertBlockActions: true };
  }
}

function collectActionStates(context: ToolbarContext): {
  active: string[];
  disabled: string[];
} {
  const active: string[] = [];
  const disabled: string[] = [];
  for (const descriptor of CONTEXT_MENU_DESCRIPTORS) {
    if (descriptor.run.type !== "adapter") continue;
    const action = descriptor.run.action;
    const item = TOOLBAR_ITEM_BY_ACTION.get(action);
    /* v8 ignore next -- @preserve reason: the WI-1.3 drift test guarantees every adapter action exists in TOOLBAR_GROUPS */
    if (!item) continue;
    const state = getToolbarItemState(item, context);
    if (state.active) active.push(action);
    if (state.disabled) disabled.push(action);
  }
  return { active, disabled };
}

/** Snapshot of the WYSIWYG surface, or null when no editor is ready.
 *  `selectionEmpty` reads the live view state (authoritative even inside
 *  the editor's initial cursor-tracking delay, when the stored cursor
 *  context can lag the caret move the trigger just dispatched). */
export function buildWysiwygSnapshot(): EditorContextMenuSnapshot | null {
  const toolbarContext = buildWysiwygContext();
  const ctx = toolbarContext.context;
  if (!toolbarContext.view || !ctx) return null;

  const { active, disabled } = collectActionStates(toolbarContext);
  return {
    surface: "wysiwyg",
    selectionEmpty: toolbarContext.view.state.selection.empty,
    inCodeBlock: Boolean(ctx.inCodeBlock),
    headingLevel: ctx.inHeading && ctx.inHeading.level > 0 ? ctx.inHeading.level : null,
    listType: ctx.inList?.listType ?? null,
    inBlockquote: Boolean(ctx.inBlockquote),
    link: ctx.inLink
      ? { href: ctx.inLink.href || null, from: ctx.inLink.from, to: ctx.inLink.to }
      : null,
    formatPolicy: getActiveFormatMenuPolicy(),
    activeActions: active,
    disabledActions: disabled,
  };
}

/** Snapshot of the Source (CodeMirror) surface, or null when not ready.
 *  Link targets are parsed from the link's source syntax (WI-4.2);
 *  unresolved targets yield `href: null`, which keeps Copy Link disabled. */
export function buildSourceSnapshot(): EditorContextMenuSnapshot | null {
  const toolbarContext = buildSourceContext();
  const ctx = toolbarContext.context;
  const view = toolbarContext.view;
  if (!view || !ctx) return null;

  const { active, disabled } = collectActionStates(toolbarContext);
  const link = ctx.inLink
    ? {
        href: getSourceLinkTarget(
          view.state.doc.sliceString(ctx.inLink.from, ctx.inLink.to),
          () => view.state.doc.toString()
        ),
        from: ctx.inLink.from,
        to: ctx.inLink.to,
      }
    : null;

  return {
    surface: "source",
    // All ranges, not just main — Cut/Copy apply to multi-cursor selections.
    selectionEmpty: view.state.selection.ranges.every((range) => range.empty),
    inCodeBlock: Boolean(ctx.inCodeBlock),
    headingLevel: ctx.inHeading && ctx.inHeading.level > 0 ? ctx.inHeading.level : null,
    listType: ctx.inList?.type ?? null,
    inBlockquote: Boolean(ctx.inBlockquote),
    link,
    formatPolicy: getActiveFormatMenuPolicy(),
    activeActions: active,
    disabledActions: disabled,
  };
}
