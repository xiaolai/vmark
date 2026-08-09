/**
 * Command context resolver
 *
 * Purpose: the single synchronous snapshot of "where the user is" that the
 *   command-availability policy (`actionAvailability`) and the editor executor
 *   both consult. Reads the tab / editor / cursor stores once and normalises the
 *   two different `CursorContext` shapes (WYSIWYG vs Source) into flat booleans —
 *   plus the full `MultiSelectionContext` (or `null`) so the palette can apply the
 *   adapters' exact multi-selection gate — so one availability predicate can serve
 *   both the Command Palette (what to show + enable) and `runEditorAction` (what to
 *   allow at execution time).
 *
 * Two-part effective read-only (Phase 2b) is resolved here; the `mutatesDocument`
 * gating that consumes it lives in `actionAvailability`.
 *
 * @coordinates-with actionAvailability.ts — the predicate over this context
 * @coordinates-with editor/editorActionGates.ts — effective-surface resolution
 * @module services/commands/commandContext
 */

import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStoreTypes";
import { useEditorStore } from "@/stores/editorStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getFormatById } from "@/lib/formats/registry";
import { isEffectiveSourceMode } from "@/services/editor/editorActionGates";
import {
  getSourceMultiSelectionContext,
  getWysiwygMultiSelectionContext,
} from "@/plugins/toolbarActions/multiSelectionContext";
import type { MultiSelectionContext } from "@/plugins/toolbarActions/types";
import type { CommandContext } from "./CommandBus";

type EditingSurface = "wysiwyg" | "source";

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
  /** True when the active document is read-only (mutating actions are hidden). */
  readOnly: boolean;
  hasSelection: boolean;
  /**
   * The FULL multi-selection context when >1 cursor is active, else `null`.
   * Carries the per-cursor structural axes (`sameBlockParent`, `inTextblock`)
   * and the universal-veto flags (`inCodeBlock`/`inTable`/`inLink`/`inImage`/
   * `inInlineMath`/`inFootnote`) that `canRunActionInMultiSelection` needs, so
   * the palette reproduces the adapters' exact multi-selection gate rather than
   * a static-policy approximation. `null` ⇔ not in multi-selection (falsy, so
   * existing truthiness consumers are unaffected).
   */
  multiSelection: MultiSelectionContext | null;
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
 * Two-part effective read-only, mirroring `SourcePane`: the document's own
 * `readOnly` flag OR (the format's `readOnlyDefault` AND no per-tab
 * `editingEnabled` override).
 */
function resolveReadOnly(tab: Tab, formatId: string | null): boolean {
  if (tab.kind !== "document") return false;
  if (useDocumentStore.getState().documents?.[tab.id]?.readOnly) return true;
  const formatConfig = formatId ? getFormatById(formatId) : undefined;
  return Boolean(formatConfig?.adapters.readOnlyDefault) && !tab.editingEnabled;
}

/**
 * Whether the active document tab of a window is currently read-only. The
 * executor re-checks this at its deferred (IME/retry) boundary so a mutation can
 * never land after the document became read-only underneath it.
 */
export function isWindowReadOnly(windowLabel: string): boolean {
  const tabStore = useTabStore.getState();
  const tabId = tabStore.activeTabId[windowLabel] ?? null;
  const tab = tabId ? tabStore.findTabById(tabId) : null;
  return tab?.kind === "document" ? resolveReadOnly(tab, tab.formatId) : false;
}

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
  const readOnly = tab ? resolveReadOnly(tab, formatId) : false;

  const mode: EditingSurface = isEffectiveSourceMode(windowLabel) ? "source" : "wysiwyg";
  const editorState = useEditorStore.getState();

  let editorAvailable: boolean;
  let cursor: CursorAxes;
  let multiCtx: MultiSelectionContext | null;
  if (mode === "source") {
    const view = editorState.active.activeSourceView;
    editorAvailable = !!view;
    cursor = editorState.source.context;
    multiCtx = view ? getSourceMultiSelectionContext(view, editorState.source.context) : null;
  } else {
    const editor = editorState.active.activeWysiwygEditor;
    const view = editor?.view ?? null;
    editorAvailable = !!view;
    cursor = editorState.tiptap.context;
    multiCtx = view ? getWysiwygMultiSelectionContext(view, null) : null;
  }
  // Store the full context only while multi-selection is actually enabled; a
  // disabled (single-cursor) context collapses to `null`.
  const multiSelection = multiCtx?.enabled ? multiCtx : null;

  return {
    windowLabel,
    mode,
    isDocument,
    formatId,
    editorAvailable,
    readOnly,
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
