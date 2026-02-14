/**
 * Image Tooltip Plugin (Tiptap)
 *
 * Purpose: Detects mouse hover over images in WYSIWYG mode and triggers the read-only
 * tooltip (filename, dimensions). Separate from the image popup which handles editing.
 *
 * Key decisions:
 *   - 300ms hover delay to avoid tooltip flicker on casual mouse movement
 *   - Suppressed when the image popup is already open (avoid visual conflict)
 *   - Uses DOM event delegation on the editor view for efficiency
 *
 * @coordinates-with ImageTooltipView.ts — renders the tooltip DOM
 * @coordinates-with stores/imageTooltipStore.ts — tooltip visibility state
 * @coordinates-with stores/imagePopupStore.ts — checks popup state to suppress tooltip
 * @module plugins/imageTooltip/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useImageTooltipStore } from "@/stores/imageTooltipStore";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { ImageTooltipView } from "./ImageTooltipView";

const imageTooltipPluginKey = new PluginKey("imageTooltip");

/** Delay before showing tooltip on hover (ms) */
const HOVER_DELAY = 300;

/**
 * Extract filename from an image src path.
 * Handles URLs, absolute paths, and relative paths.
 */
function extractFilename(src: string): string {
  if (!src) return "";

  // Handle data URLs
  if (src.startsWith("data:")) {
    return "Embedded image";
  }

  // Handle URLs and paths
  try {
    // Try to parse as URL first
    const url = new URL(src, "file://");
    const pathname = url.pathname;
    const segments = pathname.split("/");
    return decodeURIComponent(segments[segments.length - 1]) || src;
  } catch {
    // Fall back to simple path splitting
    const segments = src.split(/[/\\]/);
    return segments[segments.length - 1] || src;
  }
}

class ImageTooltipPluginView {
  private tooltipView: ImageTooltipView;
  private view: EditorView;
  private hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentImageElement: HTMLElement | null = null;

  constructor(view: EditorView) {
    this.view = view;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.tooltipView = new ImageTooltipView(view as any);

    // Add hover listeners
    view.dom.addEventListener("mouseover", this.handleMouseOver);
    view.dom.addEventListener("mouseout", this.handleMouseOut);
  }

  private handleMouseOver = (event: MouseEvent) => {
    // Don't show tooltip if edit popup is open
    if (useImagePopupStore.getState().isOpen) {
      return;
    }

    const target = event.target as HTMLElement;

    // Check for inline image or block image
    const imgElement = target.closest("img.inline-image") as HTMLImageElement | null
      ?? (target.closest(".block-image") as HTMLElement)?.querySelector("img") as HTMLImageElement | null;

    if (!imgElement) {
      this.clearHoverTimeout();
      return;
    }

    // Same image - ignore
    if (imgElement === this.currentImageElement) {
      return;
    }

    this.clearHoverTimeout();
    this.currentImageElement = imgElement;

    // Start hover delay
    this.hoverTimeout = setTimeout(() => {
      this.showTooltipForImage(imgElement);
    }, HOVER_DELAY);
  };

  private handleMouseOut = (event: MouseEvent) => {
    const relatedTarget = event.relatedTarget as HTMLElement | null;

    // Check if we're moving to the tooltip itself
    const tooltip = document.querySelector(".image-tooltip");
    if (tooltip && (tooltip.contains(relatedTarget) || tooltip === relatedTarget)) {
      return;
    }

    // Check if still within an image
    if (relatedTarget?.closest("img.inline-image, .block-image img")) {
      return;
    }

    // Left the image area
    this.clearHoverTimeout();
    this.currentImageElement = null;

    // Small delay before closing to allow moving to tooltip
    this.hoverTimeout = setTimeout(() => {
      const tooltipEl = document.querySelector(".image-tooltip");
      if (tooltipEl && !tooltipEl.matches(":hover")) {
        useImageTooltipStore.getState().hideTooltip();
      }
    }, 100);
  };

  private showTooltipForImage(imgElement: HTMLImageElement) {
    // Don't show if edit popup opened while waiting
    if (useImagePopupStore.getState().isOpen) {
      return;
    }

    try {
      // Get image src from the DOM attribute or the computed src
      // For node views, the original src is stored differently
      const src = imgElement.getAttribute("data-original-src") || imgElement.src || "";

      // Extract original src from asset:// URL if needed
      // The actual src stored in the document is usually a relative path
      const filename = extractFilename(src);

      // Get dimensions from the image element
      const dimensions = imgElement.naturalWidth > 0
        ? { width: imgElement.naturalWidth, height: imgElement.naturalHeight }
        : null;

      const rect = imgElement.getBoundingClientRect();

      useImageTooltipStore.getState().showTooltip({
        imageSrc: src,
        filename,
        dimensions,
        anchorRect: {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
        },
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug("[ImageTooltip] Failed to show tooltip:", error);
      }
    }
  }

  private clearHoverTimeout() {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
  }

  update() {
    // Tooltip updates via store subscription
  }

  destroy() {
    this.clearHoverTimeout();
    this.view.dom.removeEventListener("mouseover", this.handleMouseOver);
    this.view.dom.removeEventListener("mouseout", this.handleMouseOut);
    this.tooltipView.destroy();
  }
}

export const imageTooltipExtension = Extension.create({
  name: "imageTooltip",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: imageTooltipPluginKey,
        view: (editorView) => new ImageTooltipPluginView(editorView),
      }),
    ];
  },
});
