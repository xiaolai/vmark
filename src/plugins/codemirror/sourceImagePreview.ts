/**
 * Source Mode Image Preview Plugin
 *
 * Shows a floating preview of images when cursor is inside:
 * - Inline image: ![alt](path)
 * - Inline image with title: ![alt](path "title")
 *
 * Reuses the ImagePreviewView singleton from the imagePreview plugin.
 */

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { getImagePreviewView } from "@/plugins/imagePreview";
import { hasImageExtension } from "@/utils/imagePathDetection";

/**
 * Image markdown range result.
 */
interface ImageRange {
  /** Start position of full image markdown (from ![) */
  from: number;
  /** End position of full image markdown (to ]) */
  to: number;
  /** The image path/URL */
  path: string;
  /** The alt text */
  alt: string;
}

/**
 * Find image markdown at cursor position.
 * Detects: ![alt](path) or ![alt](path "title")
 *
 * Returns null if:
 * - Not inside an image markdown
 * - Path doesn't have image extension (skip non-image links)
 */
function findImageAtCursor(view: EditorView, pos: number): ImageRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Regex to match ![alt](path) or ![alt](path "title")
  // Captures: [1] = alt, [2] = path (without quotes and title)
  const imageRegex = /!\[([^\]]*)\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g;

  let match;
  while ((match = imageRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if cursor is inside this image markdown
    if (pos >= matchStart && pos <= matchEnd) {
      const alt = match[1];
      const path = match[2];

      // Only show preview for image extensions (skip regular links)
      if (!hasImageExtension(path) && !path.startsWith("data:image/")) {
        continue;
      }

      return {
        from: matchStart,
        to: matchEnd,
        path,
        alt,
      };
    }
  }

  return null;
}

class SourceImagePreviewPlugin {
  private view: EditorView;
  private currentImageRange: ImageRange | null = null;
  private pendingUpdate = false;
  private hoverImageRange: ImageRange | null = null;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseLeave: () => void;

  constructor(view: EditorView) {
    this.view = view;
    this.scheduleCheck();

    // Bind hover handlers
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    view.dom.addEventListener("mousemove", this.boundMouseMove);
    view.dom.addEventListener("mouseleave", this.boundMouseLeave);
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged) {
      this.scheduleCheck();
    }
  }

  private handleMouseMove(e: MouseEvent) {
    // Get position from mouse coordinates
    const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) {
      this.clearHoverPreview();
      return;
    }

    // Check for image at hover position
    const imageRange = findImageAtCursor(this.view, pos);

    // If we're hovering over same image, do nothing
    if (
      imageRange &&
      this.hoverImageRange &&
      imageRange.from === this.hoverImageRange.from &&
      imageRange.to === this.hoverImageRange.to
    ) {
      return;
    }

    // If cursor is in an image, let cursor-based preview take priority
    if (this.currentImageRange) {
      return;
    }

    if (imageRange) {
      this.hoverImageRange = imageRange;
      this.showPreviewForRange(imageRange);
    } else {
      this.clearHoverPreview();
    }
  }

  private handleMouseLeave() {
    this.clearHoverPreview();
  }

  private clearHoverPreview() {
    if (this.hoverImageRange && !this.currentImageRange) {
      this.hoverImageRange = null;
      getImagePreviewView().hide();
    }
  }

  private scheduleCheck() {
    // Defer layout reading to after the update cycle
    if (this.pendingUpdate) return;
    this.pendingUpdate = true;
    requestAnimationFrame(() => {
      this.pendingUpdate = false;
      this.checkImageAtCursor();
    });
  }

  private checkImageAtCursor() {
    const { from, to } = this.view.state.selection.main;

    // Only show preview for collapsed selection (cursor, not range)
    if (from !== to) {
      this.hidePreview();
      return;
    }

    // Check for image markdown at cursor
    const imageRange = findImageAtCursor(this.view, from);
    if (imageRange) {
      this.currentImageRange = imageRange;
      this.showPreview();
      return;
    }

    this.hidePreview();
  }

  private showPreviewForRange(imageRange: ImageRange) {
    const preview = getImagePreviewView();

    // Get coordinates for the image range
    const fromCoords = this.view.coordsAtPos(imageRange.from);
    const toCoords = this.view.coordsAtPos(imageRange.to);

    if (!fromCoords || !toCoords) {
      return;
    }

    const anchorRect = {
      top: Math.min(fromCoords.top, toCoords.top),
      left: Math.min(fromCoords.left, toCoords.left),
      bottom: Math.max(fromCoords.bottom, toCoords.bottom),
      right: Math.max(toCoords.right, fromCoords.right),
    };

    if (preview.isVisible()) {
      // Update existing preview
      preview.updateContent(imageRange.path, anchorRect);
    } else {
      // Show new preview
      preview.show(imageRange.path, anchorRect, this.view.dom);
    }
  }

  private showPreview() {
    if (!this.currentImageRange) return;
    this.showPreviewForRange(this.currentImageRange);
  }

  private hidePreview() {
    this.currentImageRange = null;
    this.hoverImageRange = null;
    getImagePreviewView().hide();
  }

  destroy() {
    // Clean up event listeners
    this.view.dom.removeEventListener("mousemove", this.boundMouseMove);
    this.view.dom.removeEventListener("mouseleave", this.boundMouseLeave);
    this.hidePreview();
  }
}

export function createSourceImagePreviewPlugin() {
  return ViewPlugin.fromClass(SourceImagePreviewPlugin);
}
