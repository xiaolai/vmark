/**
 * Mermaid Preview View
 *
 * Floating preview for mermaid diagram editing in Source mode.
 * Shows rendered diagram while user edits source.
 */

import { renderMermaid } from "@/plugins/mermaid";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

const PREVIEW_DEBOUNCE_MS = 200;

export class MermaidPreviewView {
  private container: HTMLElement;
  private preview: HTMLElement;
  private error: HTMLElement;
  private renderToken = 0;
  private visible = false;
  private editorDom: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.container = this.buildContainer();
    this.preview = this.container.querySelector(".mermaid-preview-content") as HTMLElement;
    this.error = this.container.querySelector(".mermaid-preview-error") as HTMLElement;
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "mermaid-preview-popup";
    container.style.display = "none";

    const preview = document.createElement("div");
    preview.className = "mermaid-preview-content";

    const error = document.createElement("div");
    error.className = "mermaid-preview-error";

    container.appendChild(preview);
    container.appendChild(error);

    return container;
  }

  show(content: string, anchorRect: AnchorRect, editorDom?: HTMLElement) {
    this.editorDom = editorDom ?? null;
    this.host = getPopupHostForDom(this.editorDom) ?? this.editorDom ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = "absolute";
      this.host.appendChild(this.container);
    }
    this.container.style.display = "block";
    this.visible = true;

    this.updatePosition(anchorRect);
    this.renderPreview(content);
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
        width: popupRect.width || 400,
        height: popupRect.height || 200,
      },
      bounds,
      gap: 8,
      preferAbove: false, // Prefer below for mermaid
    });

    const host = this.host ?? document.body;
    const hostPos = toHostCoordsForDom(host, { top, left });
    this.container.style.top = `${hostPos.top}px`;
    this.container.style.left = `${hostPos.left}px`;
  }

  updateContent(content: string) {
    // Debounce mermaid rendering
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.renderPreview(content);
    }, PREVIEW_DEBOUNCE_MS);
  }

  hide() {
    this.container.style.display = "none";
    this.visible = false;
    this.editorDom = null;
    this.host = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  isVisible() {
    return this.visible;
  }

  private renderPreview(content: string) {
    const trimmed = content.trim();
    this.error.textContent = "";
    this.preview.classList.remove("mermaid-preview-error-state");

    if (!trimmed) {
      this.preview.innerHTML = "";
      this.preview.classList.add("mermaid-preview-empty");
      return;
    }

    this.preview.classList.remove("mermaid-preview-empty");
    const currentToken = ++this.renderToken;

    // Show loading state
    this.preview.innerHTML = '<div class="mermaid-preview-loading">Rendering...</div>';

    renderMermaid(trimmed)
      .then((svg) => {
        if (currentToken !== this.renderToken) return;

        if (svg) {
          this.preview.innerHTML = svg;
          this.error.textContent = "";
        } else {
          this.preview.innerHTML = "";
          this.preview.classList.add("mermaid-preview-error-state");
          this.error.textContent = "Invalid mermaid syntax";
        }
      })
      .catch(() => {
        if (currentToken !== this.renderToken) return;
        this.preview.innerHTML = "";
        this.preview.classList.add("mermaid-preview-error-state");
        this.error.textContent = "Preview failed";
      });
  }

  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.container.remove();
  }
}

// Singleton instance
let previewInstance: MermaidPreviewView | null = null;

export function getMermaidPreviewView(): MermaidPreviewView {
  if (!previewInstance) {
    previewInstance = new MermaidPreviewView();
  }
  return previewInstance;
}
