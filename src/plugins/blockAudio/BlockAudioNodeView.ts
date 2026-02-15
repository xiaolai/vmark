/**
 * Block Audio NodeView
 *
 * Purpose: Custom ProseMirror NodeView for block_audio nodes — handles async audio
 * src resolution, click-to-select, and loading/error states.
 *
 * @coordinates-with tiptap.ts — registers this NodeView for the block_audio node type
 * @coordinates-with imageView/security.ts — path validation and URL classification
 * @coordinates-with stores/mediaPopupStore.ts — media popup state for click editing
 * @module plugins/blockAudio/BlockAudioNodeView
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
      console.warn("[BlockAudioView] Rejected invalid audio path:", decodedSrc);
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
      console.error("Failed to resolve audio path:", error);
      return src;
    }
  }

  return src;
}

export class BlockAudioNodeView implements NodeView {
  dom: HTMLElement;
  private audio: HTMLAudioElement;
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
    this.dom.classList.remove("media-loading", "media-error");

    if (!src) {
      this.audio.src = "";
      this.showError("No audio source");
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

    resolveMediaSrc(src).then((resolvedSrc) => {
      if (this.destroyed || requestId !== this.resolveRequestId) return;
      if (!resolvedSrc) {
        this.showError("Failed to resolve path");
        return;
      }
      this.audio.src = resolvedSrc;
      this.setupLoadHandlers();
    });
  }

  private cleanupLoadHandlers(): void {
    if (this.activeMetadataHandler) {
      this.audio.removeEventListener("loadedmetadata", this.activeMetadataHandler);
      this.activeMetadataHandler = null;
    }
    if (this.activeErrorHandler) {
      this.audio.removeEventListener("error", this.activeErrorHandler);
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
      this.showError("Failed to load audio");
      this.cleanupLoadHandlers();
    };

    this.activeMetadataHandler = onMetadata;
    this.activeErrorHandler = onError;
    this.audio.addEventListener("loadedmetadata", onMetadata);
    this.audio.addEventListener("error", onError);
  }

  private showError(message: string): void {
    this.dom.classList.remove("media-loading");
    this.dom.classList.add("media-error");
    this.audio.title = `${message}: ${this.originalSrc}`;
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
    this.cleanupLoadHandlers();
    this.dom.removeEventListener("click", this.handleClick);
  }

  stopEvent(event: Event): boolean {
    // Allow native audio controls to work
    if (event.target === this.audio && (event.type === "mousedown" || event.type === "click")) {
      return false; // Let audio controls handle it
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
