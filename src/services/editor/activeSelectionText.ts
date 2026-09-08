/**
 * Purpose: the text the user has selected in the focused editor, on whichever
 *   surface is live — read once, as plain text, for features that seed
 *   themselves from the selection (Edit → Use Selection for Find).
 *
 * Key decisions:
 *   - The FOCUSED editor wins (`view.hasFocus` / `editor.isFocused`); only when
 *     neither reports focus does the surface follow `uiStore.sourceMode`, the
 *     rule the MCP selection handlers use (`services/mcpBridge/v2/selection.ts`).
 *     `sourceMode` names the display mode, not the pane: the markdown split
 *     mounts both editors with it false, so a stale WYSIWYG selection used to
 *     win over the source pane the user was typing in (audit #468).
 *   - The markdown split mounts BOTH editors, so when the chosen editor has no
 *     selection the other surface's selection is used — but only when both are
 *     registered for the SAME tab (#470): a stale view from another tab must
 *     never supply the text.
 *   - "No selection" means a COLLAPSED selection, not empty text (#469): a node
 *     selection (an image, a rule) is a real selection whose text is "", and it
 *     does not hand the answer to the other surface.
 *   - Plain text, not markdown: the consumer is the find bar, which matches the
 *     rendered text; `textBetween` with a space separator mirrors what
 *     `findMatches.ts` sees at block boundaries.
 *
 * @coordinates-with stores/editorStore.ts — the active editor per surface
 * @coordinates-with services/search/seedFindFromSelection.ts — the consumer
 * @module services/editor/activeSelectionText
 */
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView as CodeMirrorView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";

/** A surface's selection: whether one exists at all, and its plain text. */
interface SurfaceSelection {
  hasSelection: boolean;
  text: string;
}

function wysiwygSelection(editor: TiptapEditor | null): SurfaceSelection | null {
  if (!editor) return null;
  const { from, to } = editor.state.selection;
  if (from === to) return { hasSelection: false, text: "" };
  return { hasSelection: true, text: editor.state.doc.textBetween(from, to, " ") };
}

function sourceSelection(view: CodeMirrorView | null): SurfaceSelection | null {
  if (!view) return null;
  const { from, to } = view.state.selection.main;
  if (from === to) return { hasSelection: false, text: "" };
  return { hasSelection: true, text: view.state.sliceDoc(from, to) };
}

/** The focused editor's selected text, or "" when nothing is selected. */
export function readActiveSelectionText(): string {
  const { activeWysiwygEditor, activeWysiwygTabId, activeSourceView, activeSourceTabId } =
    useEditorStore.getState().active;
  const preferSource = activeSourceView?.hasFocus
    ? true
    : activeWysiwygEditor?.isFocused
      ? false
      : useUIStore.getState().sourceMode;
  const primary = preferSource
    ? sourceSelection(activeSourceView)
    : wysiwygSelection(activeWysiwygEditor);
  if (primary?.hasSelection) return primary.text;
  // Cross surfaces only within one document.
  if (activeWysiwygTabId === null || activeWysiwygTabId !== activeSourceTabId) return "";
  const other = preferSource
    ? wysiwygSelection(activeWysiwygEditor)
    : sourceSelection(activeSourceView);
  return other?.hasSelection ? other.text : "";
}
