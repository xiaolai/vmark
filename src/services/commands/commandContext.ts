/**
 * Command context resolver
 *
 * Purpose: the single synchronous snapshot of "where the user is" that the
 *   command-availability policy (`actionAvailability`) and the editor executor
 *   both consult. Reads the tab / editor / cursor stores once and normalises the
 *   two different `CursorContext` shapes (WYSIWYG vs Source) into flat booleans,
 *   so one availability predicate can serve both the Command Palette (what to
 *   show + enable) and `runEditorAction` (what to allow at execution time).
 *
 * Read-only + `mutatesDocument` gating is intentionally NOT here — that is
 * Phase 2b. This resolver is the discoverability/context layer only.
 *
 * @coordinates-with actionAvailability.ts — the predicate over this context
 * @coordinates-with editor/editorActionGates.ts — effective-surface resolution
 * @module services/commands/commandContext
 */

import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStoreTypes";
import { useEditorStore } from "@/stores/editorStore";
import { isEffectiveSourceMode } from "@/services/editor/editorActionGates";
import {
  getSourceMultiSelectionContext,
  getWysiwygMultiSelectionContext,
} from "@/plugins/toolbarActions/multiSelectionContext";
import type { CommandContext } from "./CommandBus";

export type EditingSurface = "wysiwyg" | "source";

/**
 * The resolved, invocation-source-agnostic command context. Extends the bus's
 * free-form `CommandContext` so it can be passed straight to
 * `searchCommands`/`executeCommand` while giving commands' `when` typed fields.
 */
export interface CommandContextResolved extends CommandContext {
  windowLabel: string;
  /** Effective editing surface (source mode OR forced-source), from the executor's resolver. */
  mode: EditingSurface;
  /** True when the active tab is a live `kind: "document"` tab. */
  isDocument: boolean;
  formatId: string | null;
  /** True when the editor for the effective surface is mounted. */
  editorAvailable: boolean;
  hasSelection: boolean;
  multiSelection: boolean;
  inTable: boolean;
  inLink: boolean;
  inList: boolean;
  inBlockquote: boolean;
  inCodeBlock: boolean;
  inHeading: boolean;
}

/** Structural view of both CursorContext shapes — only the axes we normalise. */
type CursorAxes = {
  hasSelection?: boolean;
  inTable?: unknown;
  inLink?: unknown;
  inList?: unknown;
  inBlockquote?: unknown;
  inCodeBlock?: unknown;
  inHeading?: unknown;
} | null;

/**
 * Resolve the current command context for a window. Pure read of stores; safe to
 * call on every palette keystroke.
 */
export function resolveCommandContext(windowLabel: string): CommandContextResolved {
  const tabStore = useTabStore.getState();
  const activeTabId = tabStore.activeTabId[windowLabel] ?? null;
  const tab: Tab | null = activeTabId ? tabStore.findTabById(activeTabId) : null;
  const isDocument = tab?.kind === "document";
  const formatId = isDocument ? tab.formatId : null;

  const mode: EditingSurface = isEffectiveSourceMode(windowLabel) ? "source" : "wysiwyg";
  const editorState = useEditorStore.getState();

  let editorAvailable: boolean;
  let cursor: CursorAxes;
  let multiSelection: boolean;
  if (mode === "source") {
    const view = editorState.active.activeSourceView;
    editorAvailable = !!view;
    cursor = editorState.source.context;
    multiSelection = view
      ? getSourceMultiSelectionContext(view, editorState.source.context).enabled
      : false;
  } else {
    const editor = editorState.active.activeWysiwygEditor;
    const view = editor?.view ?? null;
    editorAvailable = !!view;
    cursor = editorState.tiptap.context;
    multiSelection = view ? getWysiwygMultiSelectionContext(view, null).enabled : false;
  }

  return {
    windowLabel,
    mode,
    isDocument,
    formatId,
    editorAvailable,
    hasSelection: cursor?.hasSelection ?? false,
    multiSelection,
    inTable: !!cursor?.inTable,
    inLink: !!cursor?.inLink,
    inList: !!cursor?.inList,
    inBlockquote: !!cursor?.inBlockquote,
    inCodeBlock: !!cursor?.inCodeBlock,
    inHeading: !!cursor?.inHeading,
  };
}
