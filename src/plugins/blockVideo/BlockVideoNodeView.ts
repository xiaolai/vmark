/**
 * Block Video NodeView
 *
 * Purpose: Custom ProseMirror NodeView for block_video nodes — handles async video
 * src resolution (relative/absolute/external paths), click-to-select, and loading/error states.
 *
 * Pipeline: Markdown video HTML → parser creates block_video node → this NodeView renders
 *         → resolveMediaSrc resolves path → video element displays
 *
 * Key decisions:
 *   - Video src resolution is async because relative paths need the document's directory
 *     from the Tauri path API
 *   - Uses convertFileSrc to turn local file paths into Tauri asset:// protocol URLs
 *   - Uses `loadedmetadata` event instead of `load` (video loads metadata first)
 *   - Security: relative paths are validated against directory traversal attacks
 *
 * @coordinates-with tiptap.ts — registers this NodeView for the block_video node type
 * @coordinates-with imageView/security.ts — path validation and URL classification
 * @coordinates-with stores/mediaPopupStore.ts — media popup state for click editing
 * @module plugins/blockVideo/BlockVideoNodeView
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { isAbsolutePath, isExternalUrl, isRelativePath, validateImagePath } from "@/plugins/imageView/security";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";

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

async function resolveMediaSrc(src: string): Promise<string> {
  if (isExternalUrl(src)) return src;

  const decodedSrc = decodeMarkdownUrl(src);

  if (isAbsolutePath(decodedSrc)) return convertFileSrc(normalizePathForAsset(decodedSrc));

  if (isRelativePath(decodedSrc)) {
    if (!validateImagePath(decodedSrc)) {
      console.warn("[BlockVideoView] Rejected invalid video path:", decodedSrc);
      return "";
    }

    const tabId = getActiveTabIdForCurrentWindow();
    const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
    const filePath = doc?.filePath;
    if (!filePath) return src;

    try {
      const docDir = await dirname(filePath);
      const cleanPath = decodedSrc.replace(/^\.\//, "");
      const absolutePath = await join(docDir, cleanPath);
      return convertFileSrc(normalizePathForAsset(absolutePath));
    } catch (error) {
      console.error("Failed to resolve video path:", error);
      return src;
    }
  }

  return src;
}

export class BlockVideoNodeView implements NodeView {
  dom: HTMLElement;
  private video: HTMLVideoElement;
  private originalSrc: string;
  private getPos: () => number | undefined;
  private editor: Editor;
  private resolveRequestId = 0;
  private destroyed = false;
  private activeMetadataHandler: (() => void) | null = null;
  private activeErrorHandler: (() => void) | null = null;

  constructor(node: PMNode, getPos: () => number | undefined, editor: Editor) {
    this.getPos = getPos;
    this.editor = editor;
    this.originalSrc = String(node.attrs.src ?? "");

    this.dom = document.createElement("figure");
    this.dom.className = "block-video";
    this.dom.setAttribute("data-type", "block_video");

    this.video = document.createElement("video");
    this.video.title = String(node.attrs.title ?? "");
    if (node.attrs.controls) this.video.controls = true;
    this.video.preload = (node.attrs.preload ?? "metadata") as "" | "none" | "auto" | "metadata";
    if (node.attrs.poster) this.video.poster = String(node.attrs.poster);

    this.updateSrc(this.originalSrc);

    this.dom.addEventListener("click", this.handleClick);
    this.dom.appendChild(this.video);
  }

  private handleClick = (_e: MouseEvent) => {
    const pos = this.getPos();
    if (pos === undefined) return;

    try {
      const { view } = this.editor;
      const selection = NodeSelection.create(view.state.doc, pos);
      const tr = view.state.tr.setSelection(selection);
      view.dispatch(tr.setMeta("addToHistory", false));
    } catch {
      // Ignore selection errors
    }

    const rect = this.video.getBoundingClientRect();
    useMediaPopupStore.getState().openPopup({
      mediaSrc: this.originalSrc,
      mediaTitle: this.video.title ?? "",
      mediaNodePos: pos,
      mediaNodeType: "block_video",
      mediaPoster: String(this.video.poster ?? ""),
      anchorRect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      },
    });
  };

  private updateSrc(src: string): void {
    this.dom.classList.remove("media-loading", "media-error");

    if (!src) {
      this.video.src = "";
      this.showError("No video source");
      return;
    }

    if (isExternalUrl(src)) {
      this.dom.classList.add("media-loading");
      this.video.src = src;
      this.setupLoadHandlers();
      return;
    }

    this.video.src = "";
    this.dom.classList.add("media-loading");

    const requestId = ++this.resolveRequestId;

    resolveMediaSrc(src).then((resolvedSrc) => {
      if (this.destroyed || requestId !== this.resolveRequestId) return;
      if (!resolvedSrc) {
        this.showError("Failed to resolve path");
        return;
      }
      this.video.src = resolvedSrc;
      this.setupLoadHandlers();
    });
  }

  private cleanupLoadHandlers(): void {
    if (this.activeMetadataHandler) {
      this.video.removeEventListener("loadedmetadata", this.activeMetadataHandler);
      this.activeMetadataHandler = null;
    }
    if (this.activeErrorHandler) {
      this.video.removeEventListener("error", this.activeErrorHandler);
      this.activeErrorHandler = null;
    }
  }

  private setupLoadHandlers(): void {
    this.cleanupLoadHandlers();

    const onMetadata = () => {
      if (this.destroyed) return;
      this.dom.classList.remove("media-loading", "media-error");
      this.cleanupLoadHandlers();
    };

    const onError = () => {
      if (this.destroyed) return;
      this.showError("Failed to load video");
      this.cleanupLoadHandlers();
    };

    this.activeMetadataHandler = onMetadata;
    this.activeErrorHandler = onError;
    this.video.addEventListener("loadedmetadata", onMetadata);
    this.video.addEventListener("error", onError);
  }

  private showError(message: string): void {
    this.dom.classList.remove("media-loading");
    this.dom.classList.add("media-error");
    this.video.title = `${message}: ${this.originalSrc}`;
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "block_video") return false;

    this.video.title = String(node.attrs.title ?? "");
    this.video.controls = Boolean(node.attrs.controls);
    this.video.preload = (node.attrs.preload ?? "metadata") as "" | "none" | "auto" | "metadata";
    if (node.attrs.poster) {
      this.video.poster = String(node.attrs.poster);
    }

    const newSrc = String(node.attrs.src ?? "");
    if (this.originalSrc !== newSrc) {
      this.originalSrc = newSrc;
      this.updateSrc(newSrc);
    }

    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.video.pause();
    this.video.src = "";
    this.cleanupLoadHandlers();
    this.dom.removeEventListener("click", this.handleClick);
  }

  stopEvent(event: Event): boolean {
    // Allow native video controls to work
    if (event.target === this.video && (event.type === "mousedown" || event.type === "click")) {
      // Check if click is within the video controls area (bottom of the video)
      const mouseEvent = event as MouseEvent;
      const rect = this.video.getBoundingClientRect();
      const controlsHeight = 40; // Approximate height of native controls
      if (mouseEvent.clientY > rect.bottom - controlsHeight) {
        return false; // Let video controls handle it
      }
    }
    if (event.type === "mousedown" || event.type === "click") {
      const target = event.target as HTMLElement;
      return target === this.video || target === this.dom;
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
