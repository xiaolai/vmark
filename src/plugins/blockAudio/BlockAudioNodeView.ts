/**
 * Block Audio NodeView
 *
 * Purpose: Custom ProseMirror NodeView for block_audio nodes — handles async audio
 * src resolution, click-to-select, and loading/error states.
 *
 * @coordinates-with tiptap.ts — registers this NodeView for the block_audio node type
 * @coordinates-with utils/resolveMediaSrc.ts — shared media path resolution
 * @coordinates-with stores/mediaPopupStore.ts — media popup state for click editing
 * @module plugins/blockAudio/BlockAudioNodeView
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

const AUDIO_LOAD_CONFIG: MediaLoadConfig = {
  loadEvent: "loadedmetadata",
  loadingClass: "media-loading",
  errorClass: "media-error",
};

export class BlockAudioNodeView implements NodeView {
  dom: HTMLElement;
  private audio: HTMLAudioElement;
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
    this.dom.className = "block-audio";
    this.dom.setAttribute("data-type", "block_audio");

    this.audio = document.createElement("audio");
    this.audio.title = String(node.attrs.title ?? "");
    if (node.attrs.controls) this.audio.controls = true;
    this.audio.preload = (node.attrs.preload ?? "metadata") as "" | "none" | "auto" | "metadata";

    this.updateSrc(this.originalSrc);

    this.dom.addEventListener("click", this.handleClick);
    this.dom.appendChild(this.audio);
  }

  private handleClick = (_e: MouseEvent) => {
    selectMediaNode(this.editor, this.getPos);

    const pos = this.getPos();
    if (pos === undefined) return;

    const rect = this.audio.getBoundingClientRect();
    useMediaPopupStore.getState().openPopup({
      mediaSrc: this.originalSrc,
      mediaTitle: this.audio.title ?? "",
      mediaNodePos: pos,
      mediaNodeType: "block_audio",
      mediaPoster: "",
      anchorRect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      },
    });
  };

  private updateSrc(src: string): void {
    clearMediaLoadState(this.dom, AUDIO_LOAD_CONFIG);

    if (!src) {
      this.audio.src = "";
      showMediaError(this.dom, this.audio, this.originalSrc, "No audio source", AUDIO_LOAD_CONFIG);
      return;
    }

    if (isExternalUrl(src)) {
      this.dom.classList.add("media-loading");
      this.audio.src = src;
      this.setupLoadHandlers();
      return;
    }

    this.audio.src = "";
    this.dom.classList.add("media-loading");

    const requestId = ++this.resolveRequestId;

    resolveMediaSrc(src, "[BlockAudioView]").then((resolvedSrc) => {
      if (this.destroyed || requestId !== this.resolveRequestId) return;
      if (!resolvedSrc) {
        showMediaError(this.dom, this.audio, this.originalSrc, "Failed to resolve path", AUDIO_LOAD_CONFIG);
        return;
      }
      this.audio.src = resolvedSrc;
      this.setupLoadHandlers();
    });
  }

  private setupLoadHandlers(): void {
    this.cleanupHandlers?.();
    this.cleanupHandlers = attachMediaLoadHandlers(
      this.audio,
      this.dom,
      AUDIO_LOAD_CONFIG,
      () => { /* audio has no extra onLoaded behavior */ },
      () => { showMediaError(this.dom, this.audio, this.originalSrc, "Failed to load audio", AUDIO_LOAD_CONFIG); },
    );
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "block_audio") return false;

    this.audio.title = String(node.attrs.title ?? "");
    this.audio.controls = Boolean(node.attrs.controls);
    this.audio.preload = (node.attrs.preload ?? "metadata") as "" | "none" | "auto" | "metadata";

    const newSrc = String(node.attrs.src ?? "");
    if (this.originalSrc !== newSrc) {
      this.originalSrc = newSrc;
      this.updateSrc(newSrc);
    }

    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.audio.pause();
    this.audio.src = "";
    this.cleanupHandlers?.();
    this.dom.removeEventListener("click", this.handleClick);
  }

  stopEvent(event: Event): boolean {
    // Allow native audio controls to work
    if (event.target === this.audio && (event.type === "mousedown" || event.type === "click")) {
      return false;
    }
    if (event.type === "mousedown" || event.type === "click") {
      const target = event.target as HTMLElement;
      return target === this.dom;
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
