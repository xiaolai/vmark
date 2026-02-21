/**
 * Media Preview View
 *
 * Purpose: Singleton floating preview that shows a media thumbnail (image, video, or
 * audio) when the cursor hovers over or is inside a media path — used by both
 * WYSIWYG and Source modes.
 *
 * Key decisions:
 *   - Singleton pattern (getImagePreviewView) to avoid duplicate preview elements
 *   - Resolves relative paths against the document's directory using Tauri path API
 *   - Supports external URLs, absolute paths, and relative paths
 *   - Renders `<img>`, `<video>`, or `<audio>` based on media type parameter
 *   - Video/audio use native controls with `preload="metadata"`
 *   - Positioned using the shared popup positioning system
 *   - Windows path normalization for convertFileSrc compatibility
 *
 * @coordinates-with codemirror/sourceImagePreview.ts — Source mode cursor tracking
 * @coordinates-with utils/mediaPathDetection.ts — media type detection
 * @module plugins/imagePreview/ImagePreviewView
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { renderWarn } from "@/utils/debug";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

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

/** Media type for preview rendering. */
type MediaType = "image" | "video" | "audio";

export class ImagePreviewView {
  private container: HTMLElement;
  private imageEl: HTMLImageElement;
  private videoEl: HTMLVideoElement;
  private audioEl: HTMLAudioElement;
  private errorEl: HTMLElement;
  private loadingEl: HTMLElement;
  private resolveToken = 0;
  private visible = false;
  private editorDom: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  /** Current media type being displayed. */
  private mediaType: MediaType = "image";
  // Store anchor rect for repositioning after media loads
  private lastAnchorRect: AnchorRect | null = null;

  constructor() {
    this.container = this.buildContainer();
    this.imageEl = this.container.querySelector(".image-preview-img") as HTMLImageElement;
    this.videoEl = this.container.querySelector(".image-preview-video") as HTMLVideoElement;
    this.audioEl = this.container.querySelector(".image-preview-audio") as HTMLAudioElement;
    this.errorEl = this.container.querySelector(".image-preview-error") as HTMLElement;
    this.loadingEl = this.container.querySelector(".image-preview-loading") as HTMLElement;
    // Container will be appended to host in show()
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

    const video = document.createElement("video");
    video.className = "image-preview-video";
    video.controls = true;
    video.preload = "metadata";
    video.style.display = "none";

    const audio = document.createElement("audio");
    audio.className = "image-preview-audio";
    audio.controls = true;
    audio.preload = "metadata";
    audio.style.display = "none";

    const error = document.createElement("div");
    error.className = "image-preview-error";

    container.appendChild(loading);
    container.appendChild(img);
    container.appendChild(video);
    container.appendChild(audio);
    container.appendChild(error);

    return container;
  }

  show(src: string, anchorRect: AnchorRect, editorDom?: HTMLElement, type: MediaType = "image") {
    this.editorDom = editorDom ?? null;
    this.lastAnchorRect = anchorRect;
    this.mediaType = type;

    // Mount to editor container if available, otherwise document.body
    this.host = getPopupHostForDom(this.editorDom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "block";
    this.visible = true;

    // Enable pointer events for audio/video controls
    this.container.classList.toggle("image-preview-popup--interactive", type !== "image");

    // Reset state — hide all media elements
    this.imageEl.style.display = "none";
    this.videoEl.style.display = "none";
    this.audioEl.style.display = "none";
    this.errorEl.textContent = "";
    this.loadingEl.style.display = "block";

    // Position above the anchor by default
    this.updatePosition(anchorRect);
    this.loadMedia(src, type);
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

    // Convert to host-relative coordinates if mounted inside editor container
    const host = this.host ?? document.body;
    if (host !== document.body) {
      const hostPos = toHostCoordsForDom(host, { top, left });
      this.container.style.top = `${hostPos.top}px`;
      this.container.style.left = `${hostPos.left}px`;
    } else {
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
    }
  }

  updateContent(src: string, anchorRect?: AnchorRect, type?: MediaType) {
    if (type) {
      this.mediaType = type;
      this.container.classList.toggle("image-preview-popup--interactive", type !== "image");
    }
    if (anchorRect) {
      this.lastAnchorRect = anchorRect;
      this.updatePosition(anchorRect);
    }
    this.loadMedia(src, this.mediaType);
  }

  hide() {
    this.container.style.display = "none";
    this.visible = false;
    this.editorDom = null;
    this.host = null;
    this.lastAnchorRect = null;
    // Cancel any pending loads
    this.resolveToken++;
    // Pause media to stop playback when hidden
    this.videoEl.pause();
    this.audioEl.pause();
  }

  isVisible() {
    return this.visible;
  }

  /** Hide all media elements and show loading state. */
  private resetMediaElements() {
    this.imageEl.style.display = "none";
    this.videoEl.style.display = "none";
    this.audioEl.style.display = "none";
    this.videoEl.pause();
    this.audioEl.pause();
    this.loadingEl.style.display = "block";
    this.errorEl.textContent = "";
  }

  private loadMedia(src: string, type: MediaType) {
    const trimmed = src.trim();

    if (!trimmed) {
      this.showError("No media path");
      return;
    }

    const currentToken = ++this.resolveToken;
    this.resetMediaElements();

    resolveImageSrc(trimmed)
      .then((resolvedSrc) => {
        if (currentToken !== this.resolveToken) return;

        if (type === "image") {
          this.loadImageElement(resolvedSrc, currentToken);
        } else {
          this.loadAudioVideoElement(resolvedSrc, type, currentToken);
        }
      })
      .catch((error: unknown) => {
        if (currentToken !== this.resolveToken) return;
        renderWarn("Image path resolution failed:", error instanceof Error ? error.message : String(error));
        this.showError("Path resolution failed");
      });
  }

  private loadImageElement(resolvedSrc: string, token: number) {
    const testImg = new Image();
    testImg.onload = () => {
      if (token !== this.resolveToken) return;
      this.imageEl.src = resolvedSrc;
      this.loadingEl.style.display = "none";
      this.imageEl.style.display = "block";

      // Reposition after image loads (size may have changed)
      requestAnimationFrame(() => {
        if (this.visible && this.lastAnchorRect) {
          this.updatePosition(this.lastAnchorRect);
        }
      });
    };
    testImg.onerror = () => {
      if (token !== this.resolveToken) return;
      this.showError("Failed to load");
    };
    testImg.src = resolvedSrc;
  }

  private loadAudioVideoElement(resolvedSrc: string, type: "video" | "audio", token: number) {
    const el = type === "video" ? this.videoEl : this.audioEl;

    const onReady = () => {
      cleanup();
      if (token !== this.resolveToken) return;
      this.loadingEl.style.display = "none";
      el.style.display = "block";

      requestAnimationFrame(() => {
        if (this.visible && this.lastAnchorRect) {
          this.updatePosition(this.lastAnchorRect);
        }
      });
    };

    const onError = () => {
      cleanup();
      if (token !== this.resolveToken) return;
      this.showError("Failed to load");
    };

    const cleanup = () => {
      el.removeEventListener("loadedmetadata", onReady);
      el.removeEventListener("error", onError);
    };

    el.addEventListener("loadedmetadata", onReady);
    el.addEventListener("error", onError);
    el.src = resolvedSrc;
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

/**
 * Hide the image preview if the singleton has been created.
 * Non-allocating: does nothing if no preview was ever shown.
 * Preferred over getImagePreviewView().hide() in cleanup paths
 * to avoid creating DOM elements unnecessarily.
 */
export function hideImagePreview(): void {
  previewInstance?.hide();
}
