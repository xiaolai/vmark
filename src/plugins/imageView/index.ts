/**
 * Image View Plugin
 *
 * Transforms relative image paths to asset:// URLs for rendering,
 * while keeping relative paths in the document (for portability).
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { isRelativePath, isAbsolutePath, isExternalUrl, validateImagePath } from "./security";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";

/**
 * Normalize path for convertFileSrc on Windows.
 * Windows paths use backslashes which convertFileSrc doesn't handle correctly.
 * See: https://github.com/tauri-apps/tauri/issues/7970
 */
function normalizePathForAsset(path: string): string {
  return path.replace(/\\/g, "/");
}

function getActiveTabIdForCurrentWindow(): string | null {
  try {
    const windowLabel = getWindowLabel();
    return useTabStore.getState().activeTabId[windowLabel] ?? null;
  } catch {
    return null;
  }
}

/**
 * Convert image path to asset URL for webview rendering.
 * Handles: relative paths, absolute paths, and external URLs.
 * Decodes URL-encoded paths (e.g., %20 -> space) for file system access.
 */
async function resolveImageSrc(src: string): Promise<string> {
  // External URLs (http/https/data) - use directly
  if (isExternalUrl(src)) {
    return src;
  }

  // Decode URL-encoded paths for file system access
  // Markdown may contain %20 for spaces, but filesystem needs actual spaces
  const decodedSrc = decodeMarkdownUrl(src);

  // Absolute local paths - convert to asset:// URL
  if (isAbsolutePath(decodedSrc)) {
    return convertFileSrc(normalizePathForAsset(decodedSrc));
  }

  // Relative paths - resolve against document directory
  if (isRelativePath(decodedSrc)) {
    // Validate path to prevent traversal attacks
    if (!validateImagePath(decodedSrc)) {
      console.warn("[ImageView] Rejected invalid image path:", decodedSrc);
      return "";
    }

    const tabId = getActiveTabIdForCurrentWindow();
    const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
    const filePath = doc?.filePath;
    if (!filePath) {
      return src; // No document path, can't resolve
    }

    try {
      const docDir = await dirname(filePath);
      const cleanPath = decodedSrc.replace(/^\.\//, "");
      const absolutePath = await join(docDir, cleanPath);
      return convertFileSrc(normalizePathForAsset(absolutePath));
    } catch (error) {
      console.error("Failed to resolve image path:", error);
      return src;
    }
  }

  // Unknown format - return as-is
  return src;
}

/**
 * Custom NodeView for image nodes.
 * Renders images with resolved asset URLs while keeping relative paths in the document.
 */
export class ImageNodeView implements NodeView {
  dom: HTMLImageElement;
  private originalSrc: string;
  private getPos: () => number | undefined;
  private editor: Editor;
  private resolveRequestId = 0; // Track async requests to ignore stale responses
  private destroyed = false;
  // Store active load handlers for cleanup
  private activeLoadHandler: (() => void) | null = null;
  private activeErrorHandler: (() => void) | null = null;

  constructor(node: Node, getPos: () => number | undefined, editor: Editor) {
    this.getPos = getPos;
    this.editor = editor;
    this.originalSrc = node.attrs.src ?? "";

    // Create img element directly as dom (no wrapper)
    // This simplifies DOM structure and helps with selection behavior
    this.dom = document.createElement("img");
    this.dom.className = "inline-image";
    this.dom.alt = node.attrs.alt ?? "";
    this.dom.title = node.attrs.title ?? "";

    // Set initial src and resolve if needed
    this.updateSrc(this.originalSrc);

    // Add context menu handler
    this.dom.addEventListener("contextmenu", this.handleContextMenu);

    // Add click handler for popup
    this.dom.addEventListener("click", this.handleClick);
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

    // Set NodeSelection on this node for visual selection indicator
    try {
      const { view } = this.editor;
      const selection = NodeSelection.create(view.state.doc, pos);
      view.dispatch(view.state.tr.setSelection(selection));
    } catch {
      // Ignore selection errors
    }

    const rect = this.dom.getBoundingClientRect();
    useImagePopupStore.getState().openPopup({
      imageSrc: this.originalSrc,
      imageAlt: this.dom.alt ?? "",
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
    // Reset states
    this.dom.style.opacity = "1";
    this.dom.classList.remove("image-loading", "image-error");

    if (!src) {
      this.dom.src = "";
      this.showError("No image source");
      return;
    }

    // External URLs can be used directly
    if (isExternalUrl(src)) {
      this.dom.classList.add("image-loading");
      this.dom.src = src;
      this.setupLoadHandlers();
      return;
    }

    // Relative and absolute paths need resolution
    // Show placeholder while resolving
    this.dom.src = "";
    this.dom.classList.add("image-loading");

    // Increment request ID to track this specific request
    const requestId = ++this.resolveRequestId;

    resolveImageSrc(src).then((resolvedSrc) => {
      // Ignore stale responses (src changed or view destroyed)
      if (this.destroyed || requestId !== this.resolveRequestId) {
        return;
      }
      if (!resolvedSrc) {
        this.showError("Failed to resolve path");
        return;
      }
      this.dom.src = resolvedSrc;
      this.setupLoadHandlers();
    });
  }

  private cleanupLoadHandlers(): void {
    if (this.activeLoadHandler) {
      this.dom.removeEventListener("load", this.activeLoadHandler);
      this.activeLoadHandler = null;
    }
    if (this.activeErrorHandler) {
      this.dom.removeEventListener("error", this.activeErrorHandler);
      this.activeErrorHandler = null;
    }
  }

  private setupLoadHandlers(): void {
    // Clean up any existing handlers first
    this.cleanupLoadHandlers();

    const onLoad = () => {
      if (this.destroyed) return;
      this.dom.classList.remove("image-loading", "image-error");
      this.dom.style.opacity = "1";
      this.cleanupLoadHandlers();
    };

    const onError = () => {
      if (this.destroyed) return;
      this.showError("Failed to load image");
      this.cleanupLoadHandlers();
    };

    this.activeLoadHandler = onLoad;
    this.activeErrorHandler = onError;
    this.dom.addEventListener("load", onLoad);
    this.dom.addEventListener("error", onError);
  }

  private showError(message: string): void {
    this.dom.classList.remove("image-loading");
    this.dom.classList.add("image-error");
    this.dom.style.opacity = "0.5";
    // Store original title and set error tooltip
    if (!this.dom.hasAttribute("data-original-title") && this.dom.title) {
      this.dom.setAttribute("data-original-title", this.dom.title);
    }
    this.dom.title = `${message}: ${this.originalSrc}`;
  }

  update(node: Node): boolean {
    if (node.type.name !== "image") {
      return false;
    }

    this.dom.alt = node.attrs.alt ?? "";
    this.dom.title = node.attrs.title ?? "";

    const newSrc = node.attrs.src ?? "";
    if (this.originalSrc !== newSrc) {
      this.originalSrc = newSrc;
      this.updateSrc(newSrc);
    }

    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanupLoadHandlers();
    this.dom.removeEventListener("contextmenu", this.handleContextMenu);
    this.dom.removeEventListener("click", this.handleClick);
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

  /**
   * Called when this node is selected via NodeSelection.
   * Add visual selection indicator.
   */
  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
    // Clear native browser selection to prevent visual artifacts.
    // NodeSelection in ProseMirror creates a DOM selection that visually
    // extends from doc start to the node - we don't want that shown.
    window.getSelection()?.removeAllRanges();
  }

  /**
   * Called when this node is deselected.
   * Remove visual selection indicator.
   */
  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
  }
}
