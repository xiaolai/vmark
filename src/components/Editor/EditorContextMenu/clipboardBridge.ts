/**
 * Clipboard bridge for the editor context menu.
 *
 * Purpose: Cut/Copy/Paste/Select-All are native webview roles, not
 * toolbar-adapter actions. On macOS this invokes `trigger_webview_edit`
 * (Rust sends the matching selector down the responder chain — identical
 * to the Edit menu's PredefinedMenuItems, so paste keeps full HTML/image
 * fidelity through the existing paste plugins). Elsewhere, best-effort
 * fallbacks: `document.execCommand` for cut/copy/select-all and a
 * plain-text clipboard read for paste.
 *
 * Focus contract (plan ADR-3, validated by the Phase 0 spike): the native
 * action targets the first responder, so the editor surface is refocused
 * BEFORE the command fires. ProseMirror/CodeMirror restore their own
 * selection on focus — no selection bookkeeping needed here.
 *
 * @coordinates-with src-tauri/src/webview_edit.rs — the macOS command
 * @coordinates-with menuModel.ts — emits the clipboard run entries
 * @module components/Editor/EditorContextMenu/clipboardBridge
 */

import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { EditorView as CodeMirrorView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { isMacPlatform } from "@/utils/platform";
import type { EditorMenuSurface } from "@/types/editorContextMenu";

export type ClipboardCommand = "cut" | "copy" | "paste" | "selectAll";

/**
 * Source-view override for surfaces that are not registered in
 * editorStore — SplitPaneEditor source panes run their own minimal
 * CodeMirror instances. The pane's trigger sets this when it opens the
 * menu (and clears it on destroy) so focus/paste target the right view.
 */
let sourceViewOverride: CodeMirrorView | null = null;

export function setContextMenuSourceView(view: CodeMirrorView | null): void {
  sourceViewOverride = view;
}

/** Clear the override only if it still points at `view` (a newer pane may
 *  have registered since — never clobber it). */
export function clearContextMenuSourceView(view: CodeMirrorView): void {
  if (sourceViewOverride === view) sourceViewOverride = null;
}

function getSourceView(): CodeMirrorView | null {
  return sourceViewOverride ?? useEditorStore.getState().source.editorView;
}

/** Refocus the editing surface so it is the first responder / execCommand
 *  target. Exported for the adapter/link runners, which share the
 *  "menu stole focus, give it back" concern. */
export function focusEditorSurface(surface: EditorMenuSurface): void {
  if (surface === "source") {
    getSourceView()?.focus();
    return;
  }
  useEditorStore.getState().tiptap.editorView?.focus();
}

async function pasteFallback(surface: EditorMenuSurface): Promise<void> {
  let text: string;
  try {
    text = await readText();
  } catch {
    // Clipboard unreadable (empty, non-text, or permission) — nothing to paste.
    return;
  }
  if (!text) return;

  if (surface === "source") {
    const view = getSourceView();
    if (!view) return;
    view.dispatch(view.state.replaceSelection(text));
    return;
  }
  useEditorStore.getState().tiptap.editorView?.pasteText(text);
}

/**
 * Run a clipboard command for the given surface. macOS: native responder
 * chain (full fidelity); other platforms or native failure: fallbacks
 * (plain-text paste — a documented cross-platform limitation).
 */
export async function runClipboardCommand(
  command: ClipboardCommand,
  surface: EditorMenuSurface
): Promise<void> {
  focusEditorSurface(surface);

  if (isMacPlatform()) {
    try {
      await invoke("trigger_webview_edit", { action: command });
      return;
    } catch {
      // Fall through to the DOM/plugin fallback below.
    }
  }

  if (command === "paste") {
    await pasteFallback(surface);
    return;
  }
  document.execCommand(command === "selectAll" ? "selectAll" : command);
}
