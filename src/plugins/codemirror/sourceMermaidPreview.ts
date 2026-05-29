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
  const cursorLineNum = doc.lineAt(pos).number;

  // Forward pass from line 1, pairing fences by document order rather than by
  // "has a language" — a plain ``` opener is indistinguishable from a close by
  // that heuristic (#964). A fence closes the current block only when it uses
  // the same character, is at least as long, and carries no info string
  // (CommonMark); otherwise it is content. This correctly handles a block of
  // one delimiter that contains lines of the other (e.g. ``` lines inside a
  // ~~~mermaid block) and nested/sibling blocks (#277, #278).
  let open: {
    line: number;
    from: number;
    char: string;
    len: number;
    language: string;
  } | null = null;
  let block: {
    fromLine: number;
    from: number;
    toLine: number;
    to: number;
    language: string;
  } | null = null;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.trimStart().match(/^(`{3,}|~{3,})(.*)$/);
    if (!match) continue;

    const fence = match[1];
    const rest = match[2].trim();

    if (!open) {
      // Opening fence — capture delimiter run and info-string language.
      open = {
        line: i,
        from: line.from,
        char: fence[0],
        len: fence.length,
        /* v8 ignore next -- @preserve null-coalesce: the word-char match always succeeds */
        language: (rest.match(/^\w*/)?.[0] ?? "").toLowerCase(),
      };
      continue;
    }

    // Inside a fence: a valid close needs the same char, >= length, no info.
    const isClose =
      fence[0] === open.char && fence.length >= open.len && rest === "";
    if (!isClose) continue; // content line within the open fence

    if (cursorLineNum >= open.line && cursorLineNum <= i) {
      block = {
        fromLine: open.line,
        from: open.from,
        toLine: i,
        to: line.to,
        language: open.language,
      };
      break;
    }
    open = null;
  }

  // No enclosing (closed) fence, or not a diagram language → no preview.
  if (!block || !DIAGRAM_LANGUAGES.has(block.language)) {
    return null;
  }

  // Cursor on a fence line still previews as long as pos is within the block.
  /* v8 ignore next -- @preserve Defensive guard: pos is always within [block.from, block.to] when cursorLineNum is inside the block range */
  if (pos < block.from || pos > block.to) {
    return null;
  }

  // Extract content (lines strictly between the fences).
  const contentStart = doc.line(block.fromLine + 1).from;
  const contentEnd = doc.line(block.toLine - 1).to;

  if (contentStart > contentEnd) {
    // Empty block
    return { from: block.from, to: block.to, content: "", language: block.language };
  }

  const content = doc.sliceString(contentStart, contentEnd);
  return { from: block.from, to: block.to, content, language: block.language };
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

