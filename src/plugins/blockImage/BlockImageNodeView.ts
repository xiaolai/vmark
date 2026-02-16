/**
 * Block Image NodeView
 *
 * Purpose: Custom ProseMirror NodeView for block_image nodes — handles async image
 * resolution (relative/absolute/external paths), double-click-to-popup, context menu,
 * and tooltip interactions.
 *
 * Pipeline: Markdown image → parser creates block_image node → this NodeView renders
 *         → resolveMediaSrc resolves path → img element displays
 *
 * Key decisions:
 *   - Image src resolution delegated to shared resolveMediaSrc utility
 *   - Security: relative paths validated against directory traversal attacks
 *
 * Known limitations:
 *   - No lazy loading — all visible block images resolve immediately
 *
 * @coordinates-with tiptap.ts — registers this NodeView for the block_image node type
 * @coordinates-with utils/resolveMediaSrc.ts — shared media path resolution
 * @coordinates-with stores/mediaPopupStore.ts — media popup state for click editing
 * @module plugins/blockImage/BlockImageNodeView
 */

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { isExternalUrl } from "@/plugins/imageView/security";
import { resolveMediaSrc } from "@/utils/resolveMediaSrc";
import {
  attachMediaLoadHandlers,
  showMediaError,
  clearMediaLoadState,
  selectMediaNode,
  type MediaLoadConfig,
} from "@/plugins/shared/mediaNodeViewHelpers";

const IMAGE_LOAD_CONFIG: MediaLoadConfig = {
  loadEvent: "load",
  loadingClass: "image-loading",
  errorClass: "image-error",
};

export class BlockImageNodeView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private originalSrc: string;
  private getPos: () => number | undefined;
  private editor: Editor;
  private resolveRequestId = 0;
  private destroyed = false;
  private cleanupHandlers: (() => void) | null = null;

  constructor(node: PMNode, getPos: () => number | undefined, editor: Editor) {
    this.getPos = getPos;
    this.editor = editor;
    this.originalSrc = String(node.attrs.src ?? "");

    this.dom = document.createElement("figure");
    this.dom.className = "block-image";
    this.dom.setAttribute("data-type", "block_image");

    this.img = document.createElement("img");
    this.img.alt = String(node.attrs.alt ?? "");
    this.img.title = String(node.attrs.title ?? "");

    this.updateSrc(this.originalSrc);

    this.img.addEventListener("contextmenu", this.handleContextMenu);
    this.dom.addEventListener("dblclick", this.handleClick);

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
    selectMediaNode(this.editor, this.getPos);

    const pos = this.getPos();
    if (pos === undefined) return;

    // Get dimensions from the loaded image
    const dimensions = this.img.naturalWidth > 0
      ? { width: this.img.naturalWidth, height: this.img.naturalHeight }
      : null;

    const rect = this.img.getBoundingClientRect();
    useMediaPopupStore.getState().openPopup({
      mediaSrc: this.originalSrc,
      mediaAlt: this.img.alt ?? "",
      mediaNodePos: pos,
      mediaNodeType: "block_image",
      mediaDimensions: dimensions,
      anchorRect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      },
    });
  };

  private updateSrc(src: string): void {
    // Bump request ID on every call to cancel any pending async resolution
    const requestId = ++this.resolveRequestId;

    // Reset states
    this.img.style.opacity = "1";
    clearMediaLoadState(this.dom, IMAGE_LOAD_CONFIG);
    // Restore original title if it was overwritten by error message
    const originalTitle = this.img.getAttribute("data-original-title");
    if (originalTitle !== null) {
      this.img.title = originalTitle;
      this.img.removeAttribute("data-original-title");
    }

    if (!src) {
      this.img.src = "";
      this.handleError("No image source");
      return;
    }

    if (isExternalUrl(src)) {
      this.dom.classList.add(IMAGE_LOAD_CONFIG.loadingClass);
      this.setupLoadHandlers();
      this.img.src = src;
      // Fast-path: image may already be cached
      if (this.img.complete && this.img.naturalWidth > 0) {
        this.cleanupHandlers?.();
        this.cleanupHandlers = null;
        clearMediaLoadState(this.dom, IMAGE_LOAD_CONFIG);
        this.img.style.opacity = "1";
      }
      return;
    }

    this.img.src = "";
    this.dom.classList.add(IMAGE_LOAD_CONFIG.loadingClass);

    resolveMediaSrc(src, "[BlockImageView]")
      .then((resolvedSrc) => {
        if (this.destroyed || requestId !== this.resolveRequestId) return;
        if (!resolvedSrc) {
          this.handleError("Failed to resolve path");
          return;
        }
        this.setupLoadHandlers();
        this.img.src = resolvedSrc;
      })
      .catch((err) => {
        if (this.destroyed || requestId !== this.resolveRequestId) return;
        this.handleError(err instanceof Error ? err.message : "Failed to resolve path");
      });
  }

  private setupLoadHandlers(): void {
    this.cleanupHandlers?.();
    this.cleanupHandlers = attachMediaLoadHandlers(
      this.img,
      this.dom,
      IMAGE_LOAD_CONFIG,
      () => { this.img.style.opacity = "1"; },
      () => { this.handleError("Failed to load image"); },
    );
  }

  private handleError(message: string): void {
    // Store original title before showMediaError overwrites it
    if (!this.img.hasAttribute("data-original-title")) {
      this.img.setAttribute("data-original-title", this.img.title || "");
    }
    showMediaError(this.dom, this.img, this.originalSrc, message, IMAGE_LOAD_CONFIG);
    this.img.style.opacity = "0.5";
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "block_image") return false;

    this.img.alt = String(node.attrs.alt ?? "");
    this.img.title = String(node.attrs.title ?? "");

    const newSrc = String(node.attrs.src ?? "");
    if (this.originalSrc !== newSrc) {
      this.originalSrc = newSrc;
      this.updateSrc(newSrc);
    }

    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanupHandlers?.();
    this.img.removeEventListener("contextmenu", this.handleContextMenu);
    this.dom.removeEventListener("dblclick", this.handleClick);
  }

  stopEvent(event: Event): boolean {
    if (event.type === "mousedown" || event.type === "click") {
      const target = event.target as HTMLElement;
      return target === this.img || target === this.dom;
    }
    return false;
  }

  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
    window.getSelection()?.removeAllRanges();
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
  }
}
