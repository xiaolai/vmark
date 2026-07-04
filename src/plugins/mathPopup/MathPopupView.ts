/**
 * Math Popup View
 *
 * DOM management for the inline math editing popup with live KaTeX preview.
 * Extends WysiwygPopupView for common popup lifecycle management.
 */

import i18n from "@/i18n";
import { useMathPopupStore } from "@/stores/mathPopupStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { loadKatex } from "@/plugins/latex/katexLoader";
import { renderWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";
import { WysiwygPopupView, type EditorViewLike, type PopupStoreBase } from "@/plugins/shared";

const DEFAULT_POPUP_WIDTH = 360;
const DEFAULT_POPUP_HEIGHT = 200;

/** Math popup store state (extends base with math-specific fields) */
interface MathPopupState extends PopupStoreBase {
  latex: string;
  nodePos: number | null;
  updateLatex: (latex: string) => void;
}

export class MathPopupView extends WysiwygPopupView<MathPopupState> {
  private renderToken = 0;

  constructor(view: EditorViewLike) {
    super(view, useMathPopupStore);
  }

  // Lazy getters for DOM elements (avoids constructor timing issues)
  private get textarea(): HTMLTextAreaElement {
    return this.container.querySelector(".math-popup-input") as HTMLTextAreaElement;
  }

  private get preview(): HTMLElement {
    return this.container.querySelector(".math-popup-preview") as HTMLElement;
  }

  private get error(): HTMLElement {
    return this.container.querySelector(".math-popup-error") as HTMLElement;
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "math-popup";

    const textarea = document.createElement("textarea");
    textarea.className = "math-popup-input";
    textarea.placeholder = i18n.t("editor:popup.math.input.placeholder");
    textarea.rows = 3;
    textarea.addEventListener("input", () => this.handleInputChange());
    textarea.addEventListener("keydown", (e) => this.handleTextareaKeydown(e));

    const preview = document.createElement("div");
    preview.className = "math-popup-preview";

    const error = document.createElement("div");
    error.className = "math-popup-error";

    const buttons = document.createElement("div");
    buttons.className = "math-popup-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "math-popup-btn math-popup-btn-cancel";
    cancelBtn.textContent = i18n.t("editor:popup.math.cancel");
    cancelBtn.addEventListener("click", () => this.handleCancel());

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "math-popup-btn math-popup-btn-save";
    saveBtn.textContent = i18n.t("editor:popup.math.save");
    saveBtn.addEventListener("click", () => this.handleSave());

    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);

    container.appendChild(textarea);
    container.appendChild(preview);
    container.appendChild(error);
    container.appendChild(buttons);

    return container;
  }

  protected getPopupDimensions() {
    const rect = this.container.getBoundingClientRect();
    return {
      width: rect.width || DEFAULT_POPUP_WIDTH,
      height: rect.height || DEFAULT_POPUP_HEIGHT,
      gap: 8,
      preferAbove: true,
    };
  }

  protected onShow(state: MathPopupState): void {
    this.textarea.value = state.latex;
    this.renderPreview(state.latex);

    requestAnimationFrame(() => {
      this.textarea.focus();
      this.textarea.select();
    });
  }

  protected onHide(): void {
    // No special cleanup needed
  }

  private renderPreview(latex: string): void {
    const trimmed = latex.trim();
    this.error.textContent = "";

    // Every render request invalidates any pending async render — including
    // the empty-input case, so a stale loadKatex resolve can't overwrite a
    // preview that was just cleared.
    const token = ++this.renderToken;

    if (!trimmed) {
      this.preview.textContent = "";
      return;
    }

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
          this.error.textContent = i18n.t("editor:popup.math.invalidLatex");
        }
      })
      .catch((error: unknown) => {
        if (token !== this.renderToken) return;
        renderWarn("LaTeX preview failed:", errorMessage(error));
        this.preview.textContent = trimmed;
        this.error.textContent = i18n.t("editor:popup.math.previewFailed");
      });
  }

  private handleInputChange(): void {
    const value = this.textarea.value;
    this.store.getState().updateLatex(value);
    this.renderPreview(value);
  }

  private handleTextareaKeydown(e: KeyboardEvent): void {
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
  }

  private handleSave(): void {
    const state = this.store.getState();
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
    this.focusEditor();
  }

  private handleCancel(): void {
    this.closePopup();
    this.focusEditor();
  }
}
