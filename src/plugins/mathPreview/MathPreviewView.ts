/**
 * Math Preview View
 *
 * Floating preview for inline math editing.
 * Shows rendered LaTeX while user edits source.
 * Styled like link popup (compact, inline).
 */

import { loadKatex } from "@/plugins/latex/katexLoader";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

export class MathPreviewView {
  private container: HTMLElement;
  private preview: HTMLElement;
  private error: HTMLElement;
  private renderToken = 0;
  private visible = false;
  private editorDom: HTMLElement | null = null;
  private host: HTMLElement | null = null;

  constructor() {
    this.container = this.buildContainer();
    this.preview = this.container.querySelector(".math-preview-content") as HTMLElement;
    this.error = this.container.querySelector(".math-preview-error") as HTMLElement;
    // Container will be appended to host in show()
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "math-preview-popup";
    container.style.display = "none";

    const preview = document.createElement("div");
    preview.className = "math-preview-content";

    const error = document.createElement("div");
    error.className = "math-preview-error";

    container.appendChild(preview);
    container.appendChild(error);

    return container;
  }

  show(latex: string, anchorRect: AnchorRect, editorDom?: HTMLElement) {
    this.editorDom = editorDom ?? null;

    // Mount to editor container if available, otherwise document.body
    this.host = getPopupHostForDom(this.editorDom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "block";
    this.visible = true;

    // Position below the anchor by default
    this.updatePosition(anchorRect);
    this.renderPreview(latex);
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
        width: popupRect.width || 200,
        height: popupRect.height || 40,
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

  updateContent(latex: string) {
    this.renderPreview(latex);
  }

  hide() {
    this.container.style.display = "none";
    this.visible = false;
    this.editorDom = null;
    this.host = null;
  }

  isVisible() {
    return this.visible;
  }

  private renderPreview(latex: string) {
    const trimmed = latex.trim();
    this.error.textContent = "";
    this.preview.classList.remove("math-preview-error-state");

    if (!trimmed) {
      this.preview.textContent = "";
      this.preview.classList.add("math-preview-empty");
      return;
    }

    this.preview.classList.remove("math-preview-empty");
    const currentToken = ++this.renderToken;
    this.preview.textContent = trimmed;

    loadKatex()
      .then((katex) => {
        if (currentToken !== this.renderToken) return;
        try {
          katex.default.render(trimmed, this.preview, {
            throwOnError: true,
            displayMode: false,
          });
        } catch {
          this.preview.textContent = trimmed;
          this.preview.classList.add("math-preview-error-state");
          this.error.textContent = "Invalid LaTeX";
        }
      })
      .catch(() => {
        if (currentToken !== this.renderToken) return;
        this.preview.textContent = trimmed;
        this.preview.classList.add("math-preview-error-state");
        this.error.textContent = "Preview failed";
      });
  }

  destroy() {
    this.container.remove();
  }
}

// Singleton instance
let previewInstance: MathPreviewView | null = null;

export function getMathPreviewView(): MathPreviewView {
  if (!previewInstance) {
    previewInstance = new MathPreviewView();
  }
  return previewInstance;
}
