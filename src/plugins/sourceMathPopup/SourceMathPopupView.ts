/**
 * Source Math Popup View
 *
 * Purpose: Editable math popup for Source mode — textarea for LaTeX input
 *   with live KaTeX preview. Extends SourcePopupView for consistent lifecycle
 *   (click-outside, scroll-close, Tab trapping, Escape handling).
 *
 * Key decisions:
 *   - Saves on Cmd+Enter, save-button click, and click-outside
 *   - Escape cancels (discards the edit)
 *   - Replaces the full math range (including delimiters) in the document,
 *     but only after re-validating that the captured range still wraps a math
 *     span in the current doc — protects against stale offsets from IME or
 *     concurrent edits.
 *   - DOM refs (textarea/preview/error) are queried in the constructor AFTER
 *     super(), because buildContainer runs inside super() — earlier `this.foo`
 *     assignments are wiped by class-field initialization (useDefineForClassFields).
 *   - Reuses KaTeX loading from the shared katexLoader
 *
 * @coordinates-with stores/sourceMathPopupStore.ts — popup state
 * @coordinates-with plugins/codemirror/sourceMathPreview.ts — triggers this popup
 * @coordinates-with plugins/sourcePopup/SourcePopupView.ts — base class
 * @module plugins/sourceMathPopup/SourceMathPopupView
 */

import type { EditorView } from "@codemirror/view";
import { SourcePopupView, type PopupPositionConfig } from "@/plugins/sourcePopup/SourcePopupView";
import { useSourceMathPopupStore } from "@/stores/sourceMathPopupStore";
import { loadKatex } from "@/plugins/latex/katexLoader";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { renderWarn } from "@/utils/debug";
import i18n from "@/i18n";
import "./source-math-popup.css";

type SourceMathPopupState = ReturnType<typeof useSourceMathPopupStore.getState>;

export class SourceMathPopupView extends SourcePopupView<SourceMathPopupState> {
  private textarea: HTMLTextAreaElement;
  private preview: HTMLElement;
  private error: HTMLElement;
  private renderToken = 0;

  constructor(view: EditorView) {
    super(view, useSourceMathPopupStore);
    // Query the DOM refs after super() — assignments inside buildContainer are
    // erased by class-field [[Define]] initialization in ES2022 class semantics.
    this.textarea = this.container.querySelector(".source-math-popup-input") as HTMLTextAreaElement;
    this.preview = this.container.querySelector(".source-math-popup-preview") as HTMLElement;
    this.error = this.container.querySelector(".source-math-popup-error") as HTMLElement;
    // Re-wire listeners that buildContainer attempted to bind before the arrow
    // function fields existed (same root cause as above).
    this.textarea.addEventListener("input", this.handleInputChange);
    this.textarea.addEventListener("keydown", this.handleTextareaKeydown);
    const cancelBtn = this.container.querySelector(".source-math-popup-btn-cancel");
    const saveBtn = this.container.querySelector(".source-math-popup-btn-save");
    cancelBtn?.addEventListener("click", this.handleCancel as EventListener);
    saveBtn?.addEventListener("click", this.handleSave as EventListener);
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "source-math-popup popup-container";

    const textarea = document.createElement("textarea");
    textarea.className = "source-math-popup-input";
    textarea.placeholder = i18n.t("editor:popup.math.input.placeholder");
    textarea.rows = 3;

    const preview = document.createElement("div");
    preview.className = "source-math-popup-preview";

    const error = document.createElement("div");
    error.className = "source-math-popup-error";

    const buttons = document.createElement("div");
    buttons.className = "source-math-popup-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "source-math-popup-btn source-math-popup-btn-cancel";
    cancelBtn.textContent = i18n.t("editor:popup.math.cancel");

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "source-math-popup-btn source-math-popup-btn-save";
    saveBtn.textContent = i18n.t("editor:popup.math.save");

    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);

    container.appendChild(textarea);
    container.appendChild(preview);
    container.appendChild(error);
    container.appendChild(buttons);

    return container;
  }

  protected onShow(state: SourceMathPopupState): void {
    this.textarea.value = state.latex;
    this.renderPreview(state.latex);

    requestAnimationFrame(() => {
      this.textarea.focus();
      this.textarea.select();
    });
  }

  protected onHide(): void {
    this.renderToken++;
    this.preview.textContent = "";
    this.error.textContent = "";
  }

  /**
   * Click-outside commits the edit. Defaults to base class would discard the
   * textarea content — surprising for an editor popup with unsaved text.
   */
  protected onClickOutside(): void {
    this.handleSave();
  }

  protected getPopupDimensions(): PopupPositionConfig {
    return {
      width: 360,
      height: 200,
      gap: 8,
      preferAbove: true,
    };
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
          this.error.textContent = i18n.t("editor:popup.math.invalidLatex");
        }
      })
      .catch((err: unknown) => {
        if (token !== this.renderToken) return;
        renderWarn("LaTeX preview failed:", err instanceof Error ? err.message : String(err));
        this.preview.textContent = trimmed;
        this.error.textContent = i18n.t("editor:popup.math.previewFailed");
      });
  }

  /**
   * Re-validate the captured math range against the current doc.
   * Returns true if it is safe to replace [mathFrom..mathTo] with new math.
   *
   * Why: mathFrom/mathTo were captured when the popup opened. Between then and
   * now, the doc may have been mutated (IME composition, external edit, other
   * plugin transaction). Writing back blindly can corrupt unrelated content or
   * trigger ProseMirror Fragment errors on the next round-trip.
   */
  private isRangeStillMath(mathFrom: number, mathTo: number, isBlock: boolean): boolean {
    const doc = this.editorView.state.doc;
    if (mathFrom < 0 || mathTo > doc.length || mathFrom >= mathTo) return false;
    const slice = doc.sliceString(mathFrom, mathTo);
    if (isBlock) {
      // Block math must have BOTH the opening fence AND a matching closing
      // delimiter inside the captured range. Without the close check, a range
      // whose tail drifted out from under us (closing `$$` deleted, fence
      // re-opened, etc.) would still pass and overwrite unrelated content.
      if (slice.startsWith("$$")) {
        // Need a closing `$$` AFTER the opening one on its own logical line.
        return /\n\$\$\s*$/.test(slice) || /\n\$\$\n/.test(slice);
      }
      if (/^```(?:latex|math)/.test(slice)) {
        // Need a closing ``` after the opener.
        return /\n```\s*$/.test(slice) || /\n```\n/.test(slice);
      }
      return false;
    }
    // Inline math: must start and end with a single `$` and have non-empty body.
    return slice.length >= 3 && slice.startsWith("$") && slice.endsWith("$");
  }

  private handleInputChange = () => {
    const value = this.textarea.value;
    useSourceMathPopupStore.getState().updateLatex(value);
    this.renderPreview(value);
  };

  private handleTextareaKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      this.handleSave();
      return;
    }

    // Let Escape propagate to SourcePopupView's handler
  };

  private handleSave = () => {
    const state = useSourceMathPopupStore.getState();
    const { latex, mathFrom, mathTo, isBlock, originalLatex } = state;

    // Don't save if nothing changed
    if (latex === originalLatex) {
      state.closePopup();
      this.editorView.focus();
      return;
    }

    // Validate against the current doc — abort silently rather than corrupt.
    if (!this.isRangeStillMath(mathFrom, mathTo, isBlock)) {
      state.closePopup();
      this.editorView.focus();
      return;
    }

    // Rebuild the full math expression with delimiters
    let replacement: string;
    if (isBlock) {
      // For block math, we need to determine if it was $$ or ```latex
      const existingText = this.editorView.state.doc.sliceString(mathFrom, mathTo);
      if (existingText.startsWith("```")) {
        replacement = "```latex\n" + latex + "\n```";
      } else {
        replacement = "$$\n" + latex + "\n$$";
      }
    } else {
      replacement = "$" + latex + "$";
    }

    this.editorView.dispatch({
      changes: { from: mathFrom, to: mathTo, insert: replacement },
    });

    state.closePopup();
    this.editorView.focus();
  };

  private handleCancel = () => {
    useSourceMathPopupStore.getState().closePopup();
    this.editorView.focus();
  };
}
