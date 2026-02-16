/**
 * Block Video NodeView
 *
 * Purpose: Custom ProseMirror NodeView for block_video nodes — handles async video
 * src resolution (relative/absolute/external paths), double-click-to-popup, and loading/error states.
 *
 * Pipeline: Markdown video HTML → parser creates block_video node → this NodeView renders
 *         → resolveMediaSrc resolves path → video element displays
 *
 * Key decisions:
 *   - Video src resolution delegated to shared resolveMediaSrc utility
 *   - Uses `loadedmetadata` event instead of `load` (video loads metadata first)
 *   - Security: relative paths validated against directory traversal attacks
 *
 * @coordinates-with tiptap.ts — registers this NodeView for the block_video node type
 * @coordinates-with utils/resolveMediaSrc.ts — shared media path resolution
 * @coordinates-with stores/mediaPopupStore.ts — media popup state for click editing
 * @module plugins/blockVideo/BlockVideoNodeView
 */

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { isExternalUrl } from "@/plugins/imageView/security";
import { resolveMediaSrc } from "@/utils/resolveMediaSrc";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import {
  attachMediaLoadHandlers,
  showMediaError,
  clearMediaLoadState,
  selectMediaNode,
  type MediaLoadConfig,
} from "@/plugins/shared/mediaNodeViewHelpers";

/** Approximate height of native video controls bar. Varies by platform/zoom. */
const CONTROLS_HEIGHT_PX = 40;

const VIDEO_LOAD_CONFIG: MediaLoadConfig = {
  loadEvent: "loadedmetadata",
  loadingClass: "media-loading",
  errorClass: "media-error",
};

export class BlockVideoNodeView implements NodeView {
  dom: HTMLElement;
  private video: HTMLVideoElement;
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
    this.dom.className = "block-video";
    this.dom.setAttribute("data-type", "block_video");

    this.video = document.createElement("video");
    this.video.title = String(node.attrs.title ?? "");
    if (node.attrs.controls) this.video.controls = true;
    this.video.preload = (node.attrs.preload ?? "metadata") as "" | "none" | "auto" | "metadata";
    if (node.attrs.poster) this.video.poster = String(node.attrs.poster);

    this.updateSrc(this.originalSrc);

    this.dom.addEventListener("dblclick", this.handleClick);
    this.dom.appendChild(this.video);
  }

  private handleClick = (e: MouseEvent) => {
    // Don't open popup when clicking native video controls area
    if (e.target === this.video) {
      const rect = this.video.getBoundingClientRect();
      const controlsHeight = CONTROLS_HEIGHT_PX;
      if (e.clientY > rect.bottom - controlsHeight) return;
    }

    selectMediaNode(this.editor, this.getPos);

    const pos = this.getPos();
    if (pos === undefined) return;

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
    // Bump request ID on every call to cancel any pending async resolution
    const requestId = ++this.resolveRequestId;

    clearMediaLoadState(this.dom, VIDEO_LOAD_CONFIG);

    if (!src) {
      this.video.src = "";
      showMediaError(this.dom, this.video, this.originalSrc, "No video source", VIDEO_LOAD_CONFIG);
      return;
    }

    if (isExternalUrl(src)) {
      this.dom.classList.add(VIDEO_LOAD_CONFIG.loadingClass);
      this.setupLoadHandlers();
      this.video.src = src;
      // Fast-path: media may already be cached
      if (this.video.readyState >= 1) {
        clearMediaLoadState(this.dom, VIDEO_LOAD_CONFIG);
      }
      return;
    }

    this.video.src = "";
    this.dom.classList.add(VIDEO_LOAD_CONFIG.loadingClass);

    resolveMediaSrc(src, "[BlockVideoView]")
      .then((resolvedSrc) => {
        if (this.destroyed || requestId !== this.resolveRequestId) return;
        if (!resolvedSrc) {
          showMediaError(this.dom, this.video, this.originalSrc, "Failed to resolve path", VIDEO_LOAD_CONFIG);
          return;
        }
        this.setupLoadHandlers();
        this.video.src = resolvedSrc;
      })
      .catch((err) => {
        if (this.destroyed || requestId !== this.resolveRequestId) return;
        showMediaError(this.dom, this.video, this.originalSrc, err instanceof Error ? err.message : "Failed to resolve path", VIDEO_LOAD_CONFIG);
      });
  }

  private setupLoadHandlers(): void {
    this.cleanupHandlers?.();
    this.cleanupHandlers = attachMediaLoadHandlers(
      this.video,
      this.dom,
      VIDEO_LOAD_CONFIG,
      () => { /* video has no extra onLoaded behavior */ },
      () => { showMediaError(this.dom, this.video, this.originalSrc, "Failed to load video", VIDEO_LOAD_CONFIG); },
    );
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "block_video") return false;

    this.video.title = String(node.attrs.title ?? "");
    this.video.controls = Boolean(node.attrs.controls);
    this.video.preload = (node.attrs.preload ?? "metadata") as "" | "none" | "auto" | "metadata";
    this.video.poster = String(node.attrs.poster ?? "");

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
    this.cleanupHandlers?.();
    this.dom.removeEventListener("dblclick", this.handleClick);
  }

  stopEvent(event: Event): boolean {
    // Stop ProseMirror from handling events in the native video controls area
    // (bottom ~40px). Without this, PM's mousedown captures drag state, causing
    // the scrubber/volume to "stick" and follow the cursor after mouse release.
    if (event.target === this.video && (event.type === "mousedown" || event.type === "click")) {
      const mouseEvent = event as MouseEvent;
      const rect = this.video.getBoundingClientRect();
      const controlsHeight = CONTROLS_HEIGHT_PX;
      if (mouseEvent.clientY > rect.bottom - controlsHeight) {
        return true;
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
