/**
 * Block Image View Plugin
 *
 * Custom NodeView for block images.
 * Similar to inline image view but uses figure element for block display.
 */

import { $view } from "@milkdown/kit/utils";
import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import type { NodeView } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";
import { useDocumentStore } from "@/stores/documentStore";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { getWindowLabel } from "@/utils/windowFocus";
import { isRelativePath, isAbsolutePath, isExternalUrl, validateImagePath } from "@/plugins/imageView/security";
import { blockImageSchema } from "./node";

/**
 * Convert image path to asset URL for webview rendering.
 * Handles: relative paths, absolute paths, and external URLs.
 */
async function resolveImageSrc(src: string): Promise<string> {
  // External URLs (http/https/data) - use directly
  if (isExternalUrl(src)) {
    return src;
  }

  // Absolute local paths - convert to asset:// URL
  if (isAbsolutePath(src)) {
    return convertFileSrc(src);
  }

  // Relative paths - resolve against document directory
  if (isRelativePath(src)) {
    if (!validateImagePath(src)) {
      console.warn("[BlockImageView] Rejected invalid image path:", src);
      return "";
    }

    const windowLabel = getWindowLabel();
    const doc = useDocumentStore.getState().getDocument(windowLabel);
    const filePath = doc?.filePath;
    if (!filePath) {
      return src;
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

  // Unknown format - return as-is
  return src;
}

/**
 * Custom NodeView for block image nodes.
 */
class BlockImageNodeView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private originalSrc: string;
  private getPos: () => number | undefined;
  private resolveRequestId = 0;
  private destroyed = false;

  constructor(node: Node, getPos: () => number | undefined) {
    this.getPos = getPos;
    this.originalSrc = node.attrs.src ?? "";

    // Create figure wrapper for block-level display
    this.dom = document.createElement("figure");
    this.dom.className = "block-image";
    this.dom.setAttribute("data-type", "block_image");

    // Create img element
    this.img = document.createElement("img");
    this.img.alt = node.attrs.alt ?? "";
    this.img.title = node.attrs.title ?? "";

    // Set initial src and resolve if needed
    this.updateSrc(this.originalSrc);

    // Add event handlers
    this.img.addEventListener("contextmenu", this.handleContextMenu);
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
      imageNodeType: "block_image",
      anchorRect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      },
    });
  };

  private updateSrc(src: string): void {
    this.img.style.opacity = "1";

    if (!src) {
      this.img.src = "";
      return;
    }

    // External URLs can be used directly
    if (isExternalUrl(src)) {
      this.img.src = src;
      return;
    }

    // Relative and absolute paths need resolution
    this.img.src = "";
    this.img.style.opacity = "0.5";

    const requestId = ++this.resolveRequestId;

    resolveImageSrc(src).then((resolvedSrc) => {
      if (this.destroyed || requestId !== this.resolveRequestId) {
        return;
      }
      this.img.src = resolvedSrc;
      this.img.style.opacity = "1";
    });
  }

  update(node: Node): boolean {
    if (node.type.name !== "block_image") {
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

  stopEvent(event: Event): boolean {
    if (event.type === "mousedown" || event.type === "click") {
      // Only stop events targeting the img element, not the wrapper
      return (event.target as HTMLElement) === this.img;
    }
    return false;
  }
}

/**
 * Milkdown plugin for block image rendering.
 */
export const blockImageViewPlugin = $view(blockImageSchema.node, () => {
  return (node, _view, getPos): NodeView => new BlockImageNodeView(node, getPos);
});
