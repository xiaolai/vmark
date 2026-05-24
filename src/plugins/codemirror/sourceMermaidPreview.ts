/**
 * Source Mode Diagram Preview Plugin
 *
 * Purpose: Shows a floating preview of Mermaid diagrams, Markmap mindmaps, and SVG
 * blocks when the cursor is inside their respective code fences in Source mode.
 *
 * Key decisions:
 *   - Supports three diagram languages: mermaid, markmap, svg
 *   - Reuses MermaidPreviewView singleton from the WYSIWYG mermaidPreview plugin
 *   - Debounced rendering to avoid re-rendering complex diagrams on every keystroke
 *
 * @coordinates-with mermaidPreview/MermaidPreviewView.ts — shared diagram preview rendering
 * @coordinates-with stores/editorStore.ts — reads editor mode state
 * @module plugins/codemirror/sourceMermaidPreview
 */

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { getMermaidPreviewView } from "@/plugins/mermaidPreview";
import { useUIStore } from "@/stores/uiStore";

const DIAGRAM_LANGUAGES = new Set(["mermaid", "markmap", "svg"]);

interface DiagramBlock {
  from: number;
  to: number;
  content: string;
  language: string;
}

/**
 * Find diagram code block at cursor position.
 * Returns the block's content, range, and language if cursor is inside
 * a mermaid or svg block.
 */
function findDiagramBlockAtCursor(
  view: EditorView,
  pos: number
): DiagramBlock | null {
  const doc = view.state.doc;
  const currentLine = doc.lineAt(pos);

  // Scan upward to find the opening code fence.
  // Must pair fences correctly: skip closing fences that belong to
  // inner blocks so we don't misidentify a close as an open (#277).
  let fenceStart: { line: number; from: number } | null = null;
  let language = "";
  let fenceChar = "";
  let closeFencesSkipped = 0;

  for (let i = currentLine.number; i >= 1; i--) {
    const line = doc.line(i);
    const text = line.text.trimStart();

    const fenceMatch = text.match(/^(`{3,}|~{3,})(\w*)/);
    if (fenceMatch) {
      const hasLang = fenceMatch[2].length > 0;
      const isCloseOnly = !hasLang && /^(`{3,}|~{3,})\s*$/.test(text);

      if (isCloseOnly) {
        // This is a closing fence for a block above — skip it and its pair
        closeFencesSkipped++;
      } else if (closeFencesSkipped > 0) {
        // This opening fence pairs with a skipped closing fence
        closeFencesSkipped--;
      } else {
        // Found our opening fence
        fenceStart = { line: i, from: line.from };
        language = fenceMatch[2].toLowerCase();
        fenceChar = fenceMatch[1][0]; // "`" or "~"
        break;
      }
    }
  }

  if (!fenceStart || !DIAGRAM_LANGUAGES.has(language)) {
    return null;
  }

  // Scan downward to find code fence end.
  // Only accept a closing fence that uses the same character as the
  // opening fence, per CommonMark spec (#278).
  let fenceEnd: { line: number; to: number } | null = null;
  const closingRegex = new RegExp(`^${fenceChar === "`" ? "`" : "~"}{3,}\\s*$`);

  for (let i = currentLine.number; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text.trimStart();

    // Skip the opening fence line
    if (i === fenceStart.line) continue;

    // Check for closing fence of the same type
    if (closingRegex.test(text)) {
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
    /* v8 ignore next -- @preserve Defensive guard: pos is always within [fenceStart.from, fenceEnd.to] when the cursor is on a fence line; the out-of-range case requires a cursor position that cannot exist on those lines */
    if (pos < fenceStart.from || pos > fenceEnd.to) {
      return null;
    }
  }

  // Extract content (lines between fences)
  const contentStart = doc.line(fenceStart.line + 1).from;
  const contentEnd = doc.line(fenceEnd.line - 1).to;

  if (contentStart > contentEnd) {
    // Empty block
    return { from: fenceStart.from, to: fenceEnd.to, content: "", language };
  }

  const content = doc.sliceString(contentStart, contentEnd);
  return { from: fenceStart.from, to: fenceEnd.to, content, language };
}

class SourceDiagramPreviewPlugin {
  private view: EditorView;
  private currentBlock: DiagramBlock | null = null;
  private pendingUpdate = false;
  private unsubscribe: (() => void) | null = null;
  private lastPreviewEnabled = false;

  constructor(view: EditorView) {
    this.view = view;
    this.lastPreviewEnabled = useUIStore.getState().diagramPreviewEnabled;
    // Subscribe to store changes to react when diagramPreviewEnabled toggles
    this.unsubscribe = useUIStore.subscribe((state) => {
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
      this.checkDiagramAtCursor();
    });
  }

  private checkDiagramAtCursor() {
    // Check if diagram preview is enabled
    if (!useUIStore.getState().diagramPreviewEnabled) {
      this.hidePreview();
      return;
    }

    const { from, to } = this.view.state.selection.main;

    // Only show preview for collapsed selection (cursor, not range)
    if (from !== to) {
      this.hidePreview();
      return;
    }

    const block = findDiagramBlockAtCursor(this.view, from);
    if (block) {
      this.currentBlock = block;
      this.showPreview(block.content, block.language);
      return;
    }

    this.hidePreview();
  }

  private showPreview(content: string, language: string) {
    /* v8 ignore next -- @preserve showPreview is only called after this.currentBlock is assigned (line 177); the null guard protects against future refactors */
    if (!this.currentBlock) return;

    const preview = getMermaidPreviewView();

    // Get coordinates for the code block
    const fromCoords = this.view.coordsAtPos(this.currentBlock.from);
    const toCoords = this.view.coordsAtPos(this.currentBlock.to);

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
      preview.updateContent(content, language);
      preview.updatePosition(anchorRect);
    } else {
      preview.show(content, anchorRect, this.view.dom, language);
    }
  }

  private hidePreview() {
    this.currentBlock = null;
    getMermaidPreviewView().hide();
  }

  destroy() {
    this.unsubscribe?.();
    this.hidePreview();
  }
}

export function createSourceDiagramPreviewPlugin() {
  return ViewPlugin.fromClass(SourceDiagramPreviewPlugin);
}

/**
 * All extensions for source diagram preview.
 */
export const sourceDiagramPreviewExtensions = [createSourceDiagramPreviewPlugin()];

