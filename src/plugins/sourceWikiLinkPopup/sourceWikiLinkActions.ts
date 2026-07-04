/**
 * Source Wiki Link Popup Actions
 *
 * Actions for wiki link editing in Source mode (CodeMirror 6).
 * Handles save, open, copy, and remove operations.
 */

import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { sourcePopupWarn, sourceActionError } from "@/utils/debug";
import { resolveWikiLinkPath } from "@/plugins/wikiLinkPopup/wikiLinkPaths";

/**
 * Build wiki link markdown syntax.
 * [[target]] or [[target|alias]]
 */
function buildWikiLinkMarkdown(target: string, alias: string): string {
  if (alias && alias !== target) {
    return `[[${target}|${alias}]]`;
  }
  return `[[${target}]]`;
}

function findWikiLinkAtPos(
  view: EditorView,
  pos: number
): { from: number; to: number; target: string; alias: string } | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  let match;
  while ((match = wikiLinkRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;
    /* v8 ignore next -- @preserve reason: wiki link not at cursor position loop iteration not tested */
    if (pos >= matchStart && pos <= matchEnd) {
      return {
        from: matchStart,
        to: matchEnd,
        target: match[1],
        alias: match[2] || "",
      };
    }
  }

  return null;
}

function getWikiLinkRange(view: EditorView) {
  const { nodePos } = useWikiLinkPopupStore.getState();
  if (nodePos === null) return null;
  return findWikiLinkAtPos(view, nodePos);
}

/**
 * Save wiki link changes to the document.
 * Replaces the current wiki link markdown with updated values.
 */
export function saveWikiLinkChanges(view: EditorView): void {
  const state = useWikiLinkPopupStore.getState();
  const { target } = state;
  const range = getWikiLinkRange(view);
  if (!range) {
    return;
  }

  const newMarkdown = buildWikiLinkMarkdown(target, range.alias);

  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: newMarkdown,
      },
    });
  });
}

/**
 * Open the linked file in the editor.
 */
export async function openWikiLink(): Promise<void> {
  const { target } = useWikiLinkPopupStore.getState();
  if (!target) return;

  const { rootPath } = useWorkspaceStore.getState();
  const filePath = resolveWikiLinkPath(target, rootPath);

  /* v8 ignore next -- @preserve reason: unresolvable wiki link path not tested */
  if (!filePath) {
    sourcePopupWarn("Cannot resolve wiki link target:", target);
    return;
  }

  try {
    const currentWindow = getCurrentWebviewWindow();
    await currentWindow.emit("open-file", { path: filePath });
    useWikiLinkPopupStore.getState().closePopup();
  } catch (error) {
    sourceActionError("Failed to open file:", error);
  }
}

/**
 * Copy wiki link target to clipboard.
 */
export async function copyWikiLinkTarget(): Promise<void> {
  const { target } = useWikiLinkPopupStore.getState();

  if (!target) {
    return;
  }

  try {
    await writeText(target);
  } catch (error) {
    sourceActionError("Copy failed:", error);
  }
}

/**
 * Remove wiki link from the document.
 * Removes the wiki link syntax but keeps the display text (alias or target).
 */
export function removeWikiLink(view: EditorView): void {
  const range = getWikiLinkRange(view);
  if (!range) {
    return;
  }

  // Replace with just the display text (alias if present, otherwise target)
  const displayText = range.alias || range.target;

  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: displayText,
      },
    });
  });
}
