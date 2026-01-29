/**
 * Source Mode Mermaid Preview Plugin
 *
 * Shows a floating preview of mermaid diagrams when cursor is inside
 * a ```mermaid code block in Source mode.
 */

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { getMermaidPreviewView } from "@/plugins/mermaidPreview";
import { useViewSettingsStore } from "@/stores/viewSettingsStore";

/**
 * Find mermaid code block at cursor position.
 * Returns the block's content and range if cursor is inside a mermaid block.
 */
function findMermaidBlockAtCursor(
  view: EditorView,
  pos: number
): { from: number; to: number; content: string } | null {
  const doc = view.state.doc;
  const currentLine = doc.lineAt(pos);

  // Scan upward to find code fence start
  let fenceStart: { line: number; from: number } | null = null;
  let language = "";

  for (let i = currentLine.number; i >= 1; i--) {
    const line = doc.line(i);
    const text = line.text.trimStart();

    // Check for opening fence
    const openMatch = text.match(/^(`{3,}|~{3,})(\w*)/);
    if (openMatch) {
      fenceStart = { line: i, from: line.from };
      language = openMatch[2].toLowerCase();
      break;
    }
  }

  if (!fenceStart || language !== "mermaid") {
    return null;
  }

  // Scan downward to find code fence end
  let fenceEnd: { line: number; to: number } | null = null;

  for (let i = currentLine.number; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text.trimStart();

    // Skip the opening fence line
    if (i === fenceStart.line) continue;

    // Check for closing fence
    if (/^(`{3,}|~{3,})\s*$/.test(text)) {
      fenceEnd = { line: i, to: line.to };
      break;
    }
  }

  // If no closing fence, treat as incomplete block
  if (!fenceEnd) {
    return null;
  }

  // Verify cursor is actually inside the block (not on fence lines)
  if (currentLine.number <= fenceStart.line || currentLine.number >= fenceEnd.line) {
    // Cursor is on fence line - still show preview if within range
    if (pos < fenceStart.from || pos > fenceEnd.to) {
      return null;
    }
  }

  // Extract content (lines between fences)
  const contentStart = doc.line(fenceStart.line + 1).from;
  const contentEnd = doc.line(fenceEnd.line - 1).to;

  if (contentStart > contentEnd) {
    // Empty block
    return { from: fenceStart.from, to: fenceEnd.to, content: "" };
  }

  const content = doc.sliceString(contentStart, contentEnd);
  return { from: fenceStart.from, to: fenceEnd.to, content };
}

class SourceMermaidPreviewPlugin {
  private view: EditorView;
  private currentBlockRange: { from: number; to: number; content: string } | null = null;
  private pendingUpdate = false;
  private unsubscribe: (() => void) | null = null;
  private lastPreviewEnabled = false;

  constructor(view: EditorView) {
    this.view = view;
    this.lastPreviewEnabled = useViewSettingsStore.getState().diagramPreviewEnabled;
    // Subscribe to store changes to react when diagramPreviewEnabled toggles
    this.unsubscribe = useViewSettingsStore.subscribe((state) => {
      if (state.diagramPreviewEnabled !== this.lastPreviewEnabled) {
        this.lastPreviewEnabled = state.diagramPreviewEnabled;
        this.scheduleCheck();
      }
    });
    this.scheduleCheck();
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged) {
      this.scheduleCheck();
    }
  }

  private scheduleCheck() {
    if (this.pendingUpdate) return;
    this.pendingUpdate = true;
    requestAnimationFrame(() => {
      this.pendingUpdate = false;
      this.checkMermaidAtCursor();
    });
  }

  private checkMermaidAtCursor() {
    // Check if diagram preview is enabled
    if (!useViewSettingsStore.getState().diagramPreviewEnabled) {
      this.hidePreview();
      return;
    }

    const { from, to } = this.view.state.selection.main;

    // Only show preview for collapsed selection (cursor, not range)
    if (from !== to) {
      this.hidePreview();
      return;
    }

    const blockRange = findMermaidBlockAtCursor(this.view, from);
    if (blockRange) {
      this.currentBlockRange = blockRange;
      this.showPreview(blockRange.content);
      return;
    }

    this.hidePreview();
  }

  private showPreview(content: string) {
    if (!this.currentBlockRange) return;

    const preview = getMermaidPreviewView();

    // Get coordinates for the code block
    const fromCoords = this.view.coordsAtPos(this.currentBlockRange.from);
    const toCoords = this.view.coordsAtPos(this.currentBlockRange.to);

    if (!fromCoords || !toCoords) {
      this.hidePreview();
      return;
    }

    // Use editor bounds for horizontal centering
    const editorRect = this.view.dom.getBoundingClientRect();
    const anchorRect = {
      top: Math.min(fromCoords.top, toCoords.top),
      left: editorRect.left,
      bottom: Math.max(fromCoords.bottom, toCoords.bottom),
      right: editorRect.right,
    };

    if (preview.isVisible()) {
      preview.updateContent(content);
      preview.updatePosition(anchorRect);
    } else {
      preview.show(content, anchorRect, this.view.dom);
    }
  }

  private hidePreview() {
    this.currentBlockRange = null;
    getMermaidPreviewView().hide();
  }

  destroy() {
    this.unsubscribe?.();
    this.hidePreview();
  }
}

export function createSourceMermaidPreviewPlugin() {
  return ViewPlugin.fromClass(SourceMermaidPreviewPlugin);
}

/**
 * All extensions for source mermaid preview.
 */
export const sourceMermaidPreviewExtensions = [createSourceMermaidPreviewPlugin()];
