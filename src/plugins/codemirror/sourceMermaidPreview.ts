/**
 * Source Mode Diagram Preview Plugin
 *
 * Purpose: Shows a floating preview of Mermaid diagrams, Markmap mindmaps, SVG,
 * and Graphviz blocks when the cursor is inside their respective code fences in
 * Source mode.
 *
 * Key decisions:
 *   - Supports five diagram languages: mermaid, markmap, svg, dot, graphviz
 *   - Reuses MermaidPreviewView singleton from the WYSIWYG mermaidPreview plugin
 *   - Debounced rendering to avoid re-rendering complex diagrams on every keystroke
 *   - Fence ranges are scanned once per document version and cached (CodeMirror
 *     Text is immutable, so doc identity is the cache key); pure selection
 *     changes do bounded work instead of an O(lines) rescan
 *   - Scheduled rAF work is canceled on destroy() so a destroyed plugin can
 *     never re-show the shared preview singleton
 *
 * @coordinates-with mermaidPreview/MermaidPreviewView.ts — shared diagram preview rendering
 * @coordinates-with stores/editorStore.ts — reads editor mode state
 * @module plugins/codemirror/sourceMermaidPreview
 */

import type { Text } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { getMermaidPreviewView } from "@/plugins/mermaidPreview";
import { useUIStore } from "@/stores/uiStore";

const DIAGRAM_LANGUAGES = new Set(["mermaid", "markmap", "svg", "dot", "graphviz"]);

interface DiagramBlock {
  from: number;
  to: number;
  content: string;
  language: string;
}

/** A closed fenced code block located by the document scan. */
interface FenceBlock {
  fromLine: number;
  from: number;
  toLine: number;
  to: number;
  language: string;
}

/**
 * Scan the whole document for closed fenced code blocks.
 *
 * Forward pass from line 1, pairing fences by document order rather than by
 * "has a language" — a plain ``` opener is indistinguishable from a close by
 * that heuristic (#964). A fence closes the current block only when it uses
 * the same character, is at least as long, and carries no info string
 * (CommonMark); otherwise it is content. This correctly handles a block of
 * one delimiter that contains lines of the other (e.g. ``` lines inside a
 * ~~~mermaid block) and nested/sibling blocks (#277, #278).
 */
function scanFenceBlocks(doc: Text): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  let open: {
    line: number;
    from: number;
    char: string;
    len: number;
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

    blocks.push({
      fromLine: open.line,
      from: open.from,
      toLine: i,
      to: line.to,
      language: open.language,
    });
    open = null;
  }

  return blocks;
}

/**
 * Find the diagram code block at the cursor position among the scanned fence
 * blocks. Returns the block's content, range, and language if the cursor is
 * inside a block whose language is in DIAGRAM_LANGUAGES.
 */
function findDiagramBlockAtCursor(
  doc: Text,
  blocks: FenceBlock[],
  pos: number
): DiagramBlock | null {
  const cursorLineNum = doc.lineAt(pos).number;

  const block = blocks.find(
    (b) => cursorLineNum >= b.fromLine && cursorLineNum <= b.toLine
  );

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
  private rafId: number | null = null;
  private destroyed = false;
  private unsubscribe: (() => void) | null = null;
  private lastPreviewEnabled = false;
  // Fence-scan cache: CodeMirror Text is immutable, so identity identifies
  // the doc version; pure selection changes reuse the cached blocks.
  private cachedDoc: Text | null = null;
  private cachedBlocks: FenceBlock[] = [];

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
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.pendingUpdate = false;
      this.checkDiagramAtCursor();
    });
  }

  private checkDiagramAtCursor() {
    /* v8 ignore next -- @preserve destroy() cancels the pending rAF, so this belt-and-braces guard is unreachable unless a future refactor drops the cancel */
    if (this.destroyed) return;

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

    const doc = this.view.state.doc;
    if (this.cachedDoc !== doc) {
      this.cachedBlocks = scanFenceBlocks(doc);
      this.cachedDoc = doc;
    }

    const block = findDiagramBlockAtCursor(doc, this.cachedBlocks, from);
    if (block) {
      this.currentBlock = block;
      this.showPreview(block.content, block.language);
      return;
    }

    this.hidePreview();
  }

  private showPreview(content: string, language: string) {
    /* v8 ignore next -- @preserve showPreview is only called after this.currentBlock is assigned; the null guard protects against future refactors */
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
    this.destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingUpdate = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
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
