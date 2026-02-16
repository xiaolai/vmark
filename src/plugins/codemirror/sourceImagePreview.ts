/**
 * Source Mode Media Preview Plugin
 *
 * Purpose: Shows a floating media preview (image, video, or audio) when the cursor
 * is inside a markdown image syntax (`![alt](path)`) in Source mode, giving visual
 * feedback without mode-switching.
 *
 * Key decisions:
 *   - Reuses the ImagePreviewView singleton from the WYSIWYG imagePreview plugin
 *     to avoid duplicating media loading and rendering logic
 *   - Detects media type via getMediaType() — supports image, video, and audio extensions
 *   - Hides preview when media popup is open (avoid visual conflict)
 *   - Debounces cursor position checks to avoid excessive preview updates
 *
 * @coordinates-with imagePreview/ImagePreviewView.ts — shared preview rendering singleton
 * @coordinates-with stores/mediaPopupStore.ts — checks popup visibility to avoid overlap
 * @coordinates-with utils/mediaPathDetection.ts — media type detection
 * @module plugins/codemirror/sourceImagePreview
 */

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { getImagePreviewView, hideImagePreview } from "@/plugins/imagePreview/ImagePreviewView";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { getMediaType } from "@/utils/mediaPathDetection";

/** Media type for preview rendering. */
type MediaType = "image" | "video" | "audio";

/**
 * Media markdown range result.
 */
interface MediaRange {
  /** Start position of full image markdown (from ![) */
  from: number;
  /** End position of full image markdown (to `)`) */
  to: number;
  /** The media path/URL */
  path: string;
  /** The alt text */
  alt: string;
  /** Detected media type */
  type: MediaType;
}

/**
 * Find media markdown at cursor position.
 * Detects: ![alt](path) or ![alt](path "title") or ![alt](<path with spaces>)
 *
 * Returns null if:
 * - Not inside an image markdown
 * - Path has no recognized media extension (skip non-media links)
 */
function findMediaAtCursor(view: EditorView, pos: number): MediaRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Regex to match image syntax:
  // - ![alt](path) or ![alt](path "title")
  // - ![alt](<path with spaces>) - angle bracket syntax
  // Captures: [1] = alt, [2] = angle bracket path, [3] = regular path
  const imageRegex = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"[^"]*")?\)/g;

  let match;
  while ((match = imageRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if cursor is inside this image markdown
    if (pos >= matchStart && pos < matchEnd) {
      const alt = match[1];
      // Group 2 is angle-bracket path, Group 3 is regular path
      const path = match[2] || match[3];

      // data:image/ URLs are always treated as image
      if (path.startsWith("data:image/")) {
        return { from: matchStart, to: matchEnd, path, alt, type: "image" };
      }

      // Detect media type — skip paths with no recognized extension
      const mediaType = getMediaType(path);
      if (!mediaType) continue;

      return {
        from: matchStart,
        to: matchEnd,
        path,
        alt,
        type: mediaType,
      };
    }
  }

  return null;
}

class SourceImagePreviewPlugin {
  private view: EditorView;
  private currentImageRange: MediaRange | null = null;
  private pendingUpdate = false;
  private hoverImageRange: MediaRange | null = null;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseLeave: () => void;
  /** Cached popup-open state — updated via store subscription. */
  private popupOpen = false;
  private unsubPopup: (() => void) | null = null;

  constructor(view: EditorView) {
    this.view = view;

    // Subscribe to popup store so we avoid per-event getState() calls
    this.popupOpen = useMediaPopupStore.getState().isOpen;
    this.unsubPopup = useMediaPopupStore.subscribe((state) => {
      this.popupOpen = state.isOpen;
      if (this.popupOpen) this.hidePreview();
    });

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

  /** True when the image edit popup is open — suppresses all preview. */
  private isPopupSuppressing(): boolean {
    if (!this.popupOpen) return false;
    this.hidePreview();
    return true;
  }

  private handleMouseMove(e: MouseEvent) {
    if (this.isPopupSuppressing()) return;

    // Get position from mouse coordinates
    const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) {
      this.clearHoverPreview();
      return;
    }

    // Check for media at hover position
    const imageRange = findMediaAtCursor(this.view, pos);

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
      hideImagePreview();
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

    if (this.isPopupSuppressing()) return;

    // Check for media markdown at cursor
    const imageRange = findMediaAtCursor(this.view, from);
    if (imageRange) {
      this.currentImageRange = imageRange;
      this.showPreview();
      return;
    }

    this.hidePreview();
  }

  private showPreviewForRange(imageRange: MediaRange) {
    if (this.isPopupSuppressing()) return;

    const preview = getImagePreviewView();

    // Get coordinates for the media range
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
      preview.updateContent(imageRange.path, anchorRect, imageRange.type);
    } else {
      // Show new preview
      preview.show(imageRange.path, anchorRect, this.view.dom, imageRange.type);
    }
  }

  private showPreview() {
    if (!this.currentImageRange) return;
    this.showPreviewForRange(this.currentImageRange);
  }

  private hidePreview() {
    this.currentImageRange = null;
    this.hoverImageRange = null;
    hideImagePreview();
  }

  destroy() {
    this.unsubPopup?.();
    this.view.dom.removeEventListener("mousemove", this.boundMouseMove);
    this.view.dom.removeEventListener("mouseleave", this.boundMouseLeave);
    this.hidePreview();
  }
}

export function createSourceImagePreviewPlugin() {
  return ViewPlugin.fromClass(SourceImagePreviewPlugin);
}
