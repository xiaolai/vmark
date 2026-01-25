/**
 * Image Preview View
 *
 * Floating preview for image hover/editing.
 * Shows image thumbnail while user hovers over image path.
 * Styled like link popup (compact, inline).
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";

/**
 * Normalize path for convertFileSrc on Windows.
 * Windows paths use backslashes which convertFileSrc doesn't handle correctly.
 * See: https://github.com/tauri-apps/tauri/issues/7970
 */
function normalizePathForAsset(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Maximum thumbnail dimensions */
const MAX_THUMBNAIL_WIDTH = 200;
const MAX_THUMBNAIL_HEIGHT = 150;

function getActiveFilePath(): string | null {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a path is an external URL (http/https/data).
 */
function isExternalUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:");
}

/**
 * Check if a path is a relative path.
 */
function isRelativePath(src: string): boolean {
  return src.startsWith("./") || src.startsWith("assets/");
}

/**
 * Check if a path is an absolute local path.
 */
function isAbsolutePath(src: string): boolean {
  return src.startsWith("/") || /^[A-Za-z]:/.test(src);
}

/**
 * Resolve image path to asset:// URL for preview.
 * Decodes URL-encoded paths (e.g., %20 -> space) for file system access.
 */
async function resolveImageSrc(src: string): Promise<string> {
  // External URLs - use directly
  if (isExternalUrl(src)) {
    return src;
  }

  // Decode URL-encoded paths for file system access
  const decodedSrc = decodeMarkdownUrl(src);

  // Absolute local paths - convert to asset:// URL
  if (isAbsolutePath(decodedSrc)) {
    return convertFileSrc(normalizePathForAsset(decodedSrc));
  }

  // Relative paths - resolve against document directory
  if (isRelativePath(decodedSrc)) {
    const filePath = getActiveFilePath();
    if (!filePath) {
      return src;
    }

    try {
      const docDir = await dirname(filePath);
      const cleanPath = decodedSrc.replace(/^\.\//, "");
      const absolutePath = await join(docDir, cleanPath);
      return convertFileSrc(normalizePathForAsset(absolutePath));
    } catch (error) {
      console.error("[ImagePreview] Failed to resolve path:", error);
      return src;
    }
  }

  return src;
}

export class ImagePreviewView {
  private container: HTMLElement;
  private imageEl: HTMLImageElement;
  private errorEl: HTMLElement;
  private loadingEl: HTMLElement;
  private resolveToken = 0;
  private visible = false;
  private editorDom: HTMLElement | null = null;
  // Store anchor rect for repositioning after image loads
  private lastAnchorRect: AnchorRect | null = null;

  constructor() {
    this.container = this.buildContainer();
    this.imageEl = this.container.querySelector(".image-preview-img") as HTMLImageElement;
    this.errorEl = this.container.querySelector(".image-preview-error") as HTMLElement;
    this.loadingEl = this.container.querySelector(".image-preview-loading") as HTMLElement;
    document.body.appendChild(this.container);
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "image-preview-popup";
    container.style.display = "none";

    const loading = document.createElement("div");
    loading.className = "image-preview-loading";
    loading.textContent = "Loading…";

    const img = document.createElement("img");
    img.className = "image-preview-img";
    img.style.display = "none";

    const error = document.createElement("div");
    error.className = "image-preview-error";

    container.appendChild(loading);
    container.appendChild(img);
    container.appendChild(error);

    return container;
  }

  show(src: string, anchorRect: AnchorRect, editorDom?: HTMLElement) {
    this.editorDom = editorDom ?? null;
    this.lastAnchorRect = anchorRect;
    this.container.style.display = "block";
    this.container.style.position = "fixed";
    this.visible = true;

    // Reset state
    this.imageEl.style.display = "none";
    this.errorEl.textContent = "";
    this.loadingEl.style.display = "block";

    // Position above the anchor by default
    this.updatePosition(anchorRect);
    this.loadImage(src);
  }

  updatePosition(anchorRect: AnchorRect) {
    const containerEl = this.editorDom?.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorDom as HTMLElement, containerEl)
      : getViewportBounds();

    const popupRect = this.container.getBoundingClientRect();
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: {
        width: popupRect.width || MAX_THUMBNAIL_WIDTH,
        height: popupRect.height || MAX_THUMBNAIL_HEIGHT,
      },
      bounds,
      gap: 4,
      preferAbove: true,
    });

    this.container.style.top = `${top}px`;
    this.container.style.left = `${left}px`;
  }

  updateContent(src: string, anchorRect?: AnchorRect) {
    if (anchorRect) {
      this.lastAnchorRect = anchorRect;
      this.updatePosition(anchorRect);
    }
    this.loadImage(src);
  }

  hide() {
    this.container.style.display = "none";
    this.visible = false;
    this.editorDom = null;
    this.lastAnchorRect = null;
    // Cancel any pending loads
    this.resolveToken++;
  }

  isVisible() {
    return this.visible;
  }

  private loadImage(src: string) {
    const trimmed = src.trim();

    if (!trimmed) {
      this.showError("No image path");
      return;
    }

    const currentToken = ++this.resolveToken;
    this.loadingEl.style.display = "block";
    this.imageEl.style.display = "none";
    this.errorEl.textContent = "";

    resolveImageSrc(trimmed)
      .then((resolvedSrc) => {
        if (currentToken !== this.resolveToken) return;

        // Create a temporary image to validate before showing
        const testImg = new Image();
        testImg.onload = () => {
          if (currentToken !== this.resolveToken) return;

          this.imageEl.src = resolvedSrc;
          this.loadingEl.style.display = "none";
          this.imageEl.style.display = "block";
          this.errorEl.textContent = "";

          // Reposition after image loads (size may have changed)
          requestAnimationFrame(() => {
            if (this.visible && this.lastAnchorRect) {
              this.updatePosition(this.lastAnchorRect);
            }
          });
        };

        testImg.onerror = () => {
          if (currentToken !== this.resolveToken) return;
          this.showError("Failed to load");
        };

        testImg.src = resolvedSrc;
      })
      .catch(() => {
        if (currentToken !== this.resolveToken) return;
        this.showError("Path resolution failed");
      });
  }

  private showError(message: string) {
    this.loadingEl.style.display = "none";
    this.imageEl.style.display = "none";
    this.errorEl.textContent = message;
  }

  destroy() {
    this.container.remove();
  }
}

// Singleton instance
let previewInstance: ImagePreviewView | null = null;

export function getImagePreviewView(): ImagePreviewView {
  if (!previewInstance) {
    previewInstance = new ImagePreviewView();
  }
  return previewInstance;
}
