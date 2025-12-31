/**
 * Image View Plugin
 *
 * Transforms relative image paths to asset:// URLs for rendering,
 * while keeping relative paths in the document (for portability).
 */

import { $view } from "@milkdown/kit/utils";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import type { NodeView } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";
import { useDocumentStore } from "@/stores/documentStore";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { getWindowLabel } from "@/utils/windowFocus";
import { isRelativePath, validateImagePath } from "./security";

/**
 * Convert relative path to asset URL for webview rendering.
 */
async function resolveImageSrc(src: string): Promise<string> {
  if (!isRelativePath(src)) {
    return src; // Already absolute or external URL
  }

  // Validate path to prevent traversal attacks
  if (!validateImagePath(src)) {
    console.warn("[ImageView] Rejected invalid image path:", src);
    return ""; // Return empty to prevent loading
  }

  const windowLabel = getWindowLabel();
  const doc = useDocumentStore.getState().getDocument(windowLabel);
  const filePath = doc?.filePath;
  if (!filePath) {
    return src; // No document path, can't resolve
  }

  try {
    const docDir = await dirname(filePath);
    const cleanPath = src.replace(/^\.\//, "");
    const absolutePath = await join(docDir, cleanPath);
    return convertFileSrc(absolutePath);
  } catch (error) {
    console.error("Failed to resolve image path:", error);
    return src;
  }
}

/**
 * Custom NodeView for image nodes.
 * Renders images with resolved asset URLs while keeping relative paths in the document.
 */
class ImageNodeView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private originalSrc: string;
  private getPos: () => number | undefined;
  private resolveRequestId = 0; // Track async requests to ignore stale responses
  private destroyed = false;

  constructor(node: Node, getPos: () => number | undefined) {
    this.getPos = getPos;
    this.originalSrc = node.attrs.src ?? "";

    // Create wrapper div
    this.dom = document.createElement("span");
    this.dom.className = "image-wrapper";

    // Create img element
    this.img = document.createElement("img");
    this.img.alt = node.attrs.alt ?? "";
    this.img.title = node.attrs.title ?? "";

    // Set initial src and resolve if needed
    this.updateSrc(this.originalSrc);

    // Add context menu handler
    this.img.addEventListener("contextmenu", this.handleContextMenu);

    // Add click handler for popup
    this.img.addEventListener("click", this.handleClick);

    this.dom.appendChild(this.img);
  }

  private handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const pos = this.getPos();
    if (pos === undefined) return;

    useImageContextMenuStore.getState().openMenu({
      position: { x: e.clientX, y: e.clientY },
      imageSrc: this.originalSrc,
      imageNodePos: pos,
    });
  };

  private handleClick = (_e: MouseEvent) => {
    const pos = this.getPos();
    if (pos === undefined) return;

    const rect = this.img.getBoundingClientRect();
    useImagePopupStore.getState().openPopup({
      imageSrc: this.originalSrc,
      imageAlt: this.img.alt ?? "",
      imageNodePos: pos,
      anchorRect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      },
    });
  };

  private updateSrc(src: string): void {
    // Always reset opacity first
    this.img.style.opacity = "1";

    if (!src) {
      this.img.src = "";
      return;
    }

    if (isRelativePath(src)) {
      // Show placeholder while resolving
      this.img.src = "";
      this.img.style.opacity = "0.5";

      // Increment request ID to track this specific request
      const requestId = ++this.resolveRequestId;

      resolveImageSrc(src).then((resolvedSrc) => {
        // Ignore stale responses (src changed or view destroyed)
        if (this.destroyed || requestId !== this.resolveRequestId) {
          return;
        }
        this.img.src = resolvedSrc;
        this.img.style.opacity = "1";
      });
    } else {
      this.img.src = src;
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== "image") {
      return false;
    }

    this.img.alt = node.attrs.alt ?? "";
    this.img.title = node.attrs.title ?? "";

    const newSrc = node.attrs.src ?? "";
    if (this.originalSrc !== newSrc) {
      this.originalSrc = newSrc;
      this.updateSrc(newSrc);
    }

    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.img.removeEventListener("contextmenu", this.handleContextMenu);
    this.img.removeEventListener("click", this.handleClick);
  }

  /**
   * Prevent ProseMirror from handling mouse events on the image.
   * This stops the selection from expanding when clicking on images.
   */
  stopEvent(event: Event): boolean {
    // Stop mousedown/click to prevent text selection
    if (event.type === "mousedown" || event.type === "click") {
      return true;
    }
    return false;
  }
}

/**
 * Milkdown plugin for custom image rendering.
 */
export const imageViewPlugin = $view(imageSchema.node, () => {
  return (node, _view, getPos): NodeView => new ImageNodeView(node, getPos);
});

export default imageViewPlugin;
