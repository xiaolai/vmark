/**
 * Math Popup View
 *
 * DOM management for the inline math editing popup.
 */

import type { EditorView } from "@tiptap/pm/view";
import { useMathPopupStore } from "@/stores/mathPopupStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { loadKatex } from "@/plugins/latex/katexLoader";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

const DEFAULT_POPUP_WIDTH = 360;
const DEFAULT_POPUP_HEIGHT = 200;

export class MathPopupView {
  private container: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private preview: HTMLElement;
  private error: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private justOpened = false;
  private wasOpen = false;
  private renderToken = 0;
  private host: HTMLElement | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    this.container = this.buildContainer();
    this.textarea = this.container.querySelector(
      ".math-popup-input"
    ) as HTMLTextAreaElement;
    this.preview = this.container.querySelector(
      ".math-popup-preview"
    ) as HTMLElement;
    this.error = this.container.querySelector(
      ".math-popup-error"
    ) as HTMLElement;

    // Container will be appended to host in show()

    this.unsubscribe = useMathPopupStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        if (!this.wasOpen) {
          this.show(state.latex, state.anchorRect);
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });

    document.addEventListener("mousedown", this.handleClickOutside);
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "math-popup";
    container.style.display = "none";

    const textarea = document.createElement("textarea");
    textarea.className = "math-popup-input";
    textarea.placeholder = "Enter LaTeX...";
    textarea.rows = 3;
    textarea.addEventListener("input", this.handleInputChange);
    textarea.addEventListener("keydown", this.handleKeydown);

    const preview = document.createElement("div");
    preview.className = "math-popup-preview";

    const error = document.createElement("div");
    error.className = "math-popup-error";

    const buttons = document.createElement("div");
    buttons.className = "math-popup-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "math-popup-btn math-popup-btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", this.handleCancel);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "math-popup-btn math-popup-btn-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", this.handleSave);

    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);

    container.appendChild(textarea);
    container.appendChild(preview);
    container.appendChild(error);
    container.appendChild(buttons);

    return container;
  }

  private show(latex: string, anchorRect: AnchorRect) {
    this.textarea.value = latex;

    // Mount to editor container if available, otherwise document.body
    this.host = getPopupHostForDom(this.editorView.dom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    const containerEl = this.editorView.dom.closest(
      ".editor-container"
    ) as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    const popupRect = this.container.getBoundingClientRect();
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: {
        width: popupRect.width || DEFAULT_POPUP_WIDTH,
        height: popupRect.height || DEFAULT_POPUP_HEIGHT,
      },
      bounds,
      gap: 8,
      preferAbove: true,
    });

    // Convert to host-relative coordinates if mounted inside editor container
    if (this.host !== document.body) {
      const hostPos = toHostCoordsForDom(this.host, { top, left });
      this.container.style.top = `${hostPos.top}px`;
      this.container.style.left = `${hostPos.left}px`;
    } else {
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
    }

    this.renderPreview(latex);

    requestAnimationFrame(() => {
      this.textarea.focus();
      this.textarea.select();
    });
  }

  private hide() {
    this.container.style.display = "none";
    this.host = null;
  }

  private renderPreview(latex: string) {
    const trimmed = latex.trim();
    this.error.textContent = "";

    if (!trimmed) {
      this.preview.textContent = "";
      return;
    }

    const token = ++this.renderToken;

    loadKatex()
      .then((katex) => {
        if (token !== this.renderToken) return;
        try {
          katex.default.render(trimmed, this.preview, {
            throwOnError: true,
            displayMode: false,
          });
        } catch {
          this.preview.textContent = trimmed;
          this.error.textContent = "Invalid LaTeX";
        }
      })
      .catch(() => {
        if (token !== this.renderToken) return;
        this.preview.textContent = trimmed;
        this.error.textContent = "LaTeX preview failed";
      });
  }

  private handleInputChange = () => {
    const value = this.textarea.value;
    useMathPopupStore.getState().updateLatex(value);
    this.renderPreview(value);
  };

  private handleKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.handleCancel();
      return;
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.handleSave();
    }
  };

  private handleSave = () => {
    const state = useMathPopupStore.getState();
    const { nodePos, latex } = state;
    if (nodePos === null) return;

    const { state: editorState, dispatch } = this.editorView;
    const node = editorState.doc.nodeAt(nodePos);
    if (!node || node.type.name !== "math_inline") {
      state.closePopup();
      return;
    }

    const tr = editorState.tr.setNodeMarkup(nodePos, undefined, {
      ...node.attrs,
      content: latex,
    });

    dispatch(tr);
    state.closePopup();
    this.editorView.focus();
  };

  private handleCancel = () => {
    useMathPopupStore.getState().closePopup();
    this.editorView.focus();
  };

  private handleClickOutside = (e: MouseEvent) => {
    if (this.justOpened) return;
    const { isOpen } = useMathPopupStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      useMathPopupStore.getState().closePopup();
    }
  };

  destroy() {
    this.unsubscribe();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}
