/**
 * Source Math Popup View
 *
 * Popup view for editing math in Source mode (CodeMirror 6).
 * Allows editing LaTeX with live preview.
 */

import type { EditorView } from "@codemirror/view";
import { SourcePopupView, type StoreApi } from "@/plugins/sourcePopup";
import { useMathPopupStore } from "@/stores/mathPopupStore";
import { loadKatex } from "@/plugins/latex/katexLoader";
import { removeMath, saveMathChanges } from "./sourceMathActions";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { findMathAtPos } from "./mathDetection";

/**
 * Source math popup view.
 * Extends the base SourcePopupView for common functionality.
 */
type MathPopupStoreState = ReturnType<typeof useMathPopupStore.getState>;

export class SourceMathPopupView extends SourcePopupView<MathPopupStoreState> {
  private textarea!: HTMLTextAreaElement;
  private preview!: HTMLElement;
  private error!: HTMLElement;
  private renderToken = 0;
  private isBlock = false;

  constructor(view: EditorView, store: StoreApi<MathPopupStoreState>) {
    super(view, store);
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "source-math-popup";

    // Textarea for LaTeX input
    this.textarea = document.createElement("textarea");
    this.textarea.className = "source-math-popup-input";
    this.textarea.placeholder = "Enter LaTeX...";
    this.textarea.rows = 3;
    this.textarea.addEventListener("input", this.handleInput);
    this.textarea.addEventListener("keydown", this.handleTextareaKeydown);

    // Preview area
    this.preview = document.createElement("div");
    this.preview.className = "source-math-popup-preview";

    // Error message
    this.error = document.createElement("div");
    this.error.className = "source-math-popup-error";

    // Button row
    const buttons = document.createElement("div");
    buttons.className = "source-math-popup-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "source-math-popup-btn source-math-popup-btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", this.handleCancel);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "source-math-popup-btn source-math-popup-btn-remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", this.handleRemove);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "source-math-popup-btn source-math-popup-btn-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", this.handleSave);

    buttons.appendChild(cancelBtn);
    buttons.appendChild(removeBtn);
    buttons.appendChild(saveBtn);

    container.appendChild(this.textarea);
    container.appendChild(this.preview);
    container.appendChild(this.error);
    container.appendChild(buttons);

    return container;
  }

  protected getPopupDimensions() {
    return {
      width: 360,
      height: 200,
      gap: 8,
      preferAbove: true,
    };
  }

  protected onShow(state: MathPopupStoreState): void {
    // Set textarea value from store
    this.textarea.value = state.latex;

    // Clear previous errors
    this.error.textContent = "";

    const math = state.nodePos !== null ? findMathAtPos(this.editorView, state.nodePos) : null;
    this.isBlock = math?.isBlock ?? false;

    // Render initial preview
    this.renderPreview(state.latex);

    // Focus textarea after a brief delay
    requestAnimationFrame(() => {
      this.textarea.focus();
      this.textarea.select();
    });
  }

  protected onHide(): void {
    // Clear inputs
    this.textarea.value = "";
    this.preview.textContent = "";
    this.error.textContent = "";
    this.renderToken++;
    this.isBlock = false;
  }

  private handleInput = (): void => {
    const value = this.textarea.value;
    useMathPopupStore.getState().updateLatex(value);
    this.renderPreview(value);
  };

  private handleTextareaKeydown = (e: KeyboardEvent): void => {
    if (isImeKeyEvent(e)) return;

    // Cmd/Ctrl+Enter to save
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.handleSave();
    }
    // Escape is handled by base class
  };

  private renderPreview(latex: string): void {
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
          // Use displayMode for block math
          katex.default.render(trimmed, this.preview, {
            throwOnError: true,
            displayMode: this.isBlock,
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

  private handleSave = (): void => {
    saveMathChanges(this.editorView);
    this.closePopup();
    this.focusEditor();
  };

  private handleCancel = (): void => {
    this.closePopup();
    this.focusEditor();
  };

  private handleRemove = (): void => {
    removeMath(this.editorView);
    this.closePopup();
    this.focusEditor();
  };
}
