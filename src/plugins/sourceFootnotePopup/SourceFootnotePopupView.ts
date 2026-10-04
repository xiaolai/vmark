/**
 * Source Footnote Popup View
 *
 * Popup view for editing footnotes in Source mode (CodeMirror 6).
 * Shows label, textarea for content, goto/save/delete buttons.
 *
 * Re-shows while open when the hover moves to another footnote or another
 * reference to the same one, and positions from its rendered height after the
 * content is in place — the popup sits above its anchor, so a stale or assumed
 * height puts it at the wrong distance (#1494).
 *
 * @module plugins/sourceFootnotePopup/SourceFootnotePopupView
 */

import type { EditorView } from "@codemirror/view";
import type { AnchorRect } from "@/utils/popupPosition";
import i18n from "@/i18n";
import { SourcePopupView, type StoreApi } from "@/plugins/shared/SourcePopupView";
import type { FootnotePopupState } from "@/plugins/shared/popupPorts";
import { buildPopupIconButton, popupIcons } from "@/utils/popupComponents";
import { isImeKeyEvent } from "@/utils/imeGuard";
import {
  saveFootnoteContent,
  gotoFootnoteTarget,
  removeFootnote,
} from "./sourceFootnoteActions";

const TEXTAREA_MAX_HEIGHT = 120;
const DEFAULT_POPUP_WIDTH = 300;
const DEFAULT_POPUP_HEIGHT = 100;

/** Build a source-footnote popup icon button on the canonical `.popup-icon-btn` surface (WI-DP4.1). */
function buildSourceFootnoteBtn(iconSvg: string, title: string, onClick: () => void): HTMLButtonElement {
  return buildPopupIconButton({ iconSvg, title, onClick });
}

/**
 * Source footnote popup view.
 * Extends the base SourcePopupView for common functionality.
 */
export class SourceFootnotePopupView extends SourcePopupView<FootnotePopupState> {
  // Use 'declare' to avoid ES2022 class field initialization overwriting values set in buildContainer()
  private declare labelSpan: HTMLSpanElement;
  private declare textarea: HTMLTextAreaElement;
  private declare gotoBtn: HTMLButtonElement;
  private openedOnReference = true;

  constructor(view: EditorView, store: StoreApi<FootnotePopupState>) {
    super(view, store);
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "popup-container source-footnote-popup";

    // Row 1: Label display + buttons
    const headerRow = document.createElement("div");
    headerRow.className = "source-footnote-popup-header";

    this.labelSpan = document.createElement("span");
    this.labelSpan.className = "source-footnote-popup-label";

    const spacer = document.createElement("div");
    spacer.style.flex = "1";

    this.gotoBtn = buildSourceFootnoteBtn(popupIcons.goto, i18n.t("editor:popup.footnote.goToDefinition"), this.handleGoto.bind(this));
    this.gotoBtn.classList.add("source-footnote-popup-btn-goto");
    const saveBtn = buildSourceFootnoteBtn(popupIcons.save, i18n.t("editor:popup.footnote.save"), this.handleSave.bind(this));
    saveBtn.classList.add("popup-icon-btn--primary", "source-footnote-popup-btn-save");
    const deleteBtn = buildSourceFootnoteBtn(popupIcons.delete, i18n.t("editor:popup.footnote.remove"), this.handleDelete.bind(this));
    deleteBtn.classList.add("popup-icon-btn--danger", "source-footnote-popup-btn-delete");

    headerRow.appendChild(this.labelSpan);
    headerRow.appendChild(spacer);
    headerRow.appendChild(this.gotoBtn);
    headerRow.appendChild(saveBtn);
    headerRow.appendChild(deleteBtn);

    // Row 2: Textarea for content
    this.textarea = document.createElement("textarea");
    this.textarea.className = "source-footnote-popup-textarea";
    this.textarea.placeholder = i18n.t("editor:popup.footnote.content.placeholder");
    this.textarea.rows = 2;
    this.textarea.addEventListener("input", this.handleTextareaInput.bind(this));
    this.textarea.addEventListener("keydown", this.handleTextareaKeydown.bind(this));

    container.appendChild(headerRow);
    container.appendChild(this.textarea);

    return container;
  }

  protected override shouldReshow(prev: FootnotePopupState, state: FootnotePopupState): boolean {
    return state.label !== prev.label || state.referencePos !== prev.referencePos;
  }

  protected override getPopupDimensions() {
    const rect = this.container.getBoundingClientRect();
    return {
      width: rect.width || DEFAULT_POPUP_WIDTH,
      height: rect.height || DEFAULT_POPUP_HEIGHT,
      gap: 6,
      preferAbove: true,
    };
  }

  /** Size the textarea for the current content before measuring the popup. */
  protected override updatePosition(anchorRect: AnchorRect): void {
    this.autoResizeTextarea();
    super.updatePosition(anchorRect);
  }

  /** Re-anchor at the store's anchor, using the popup's current height. */
  private reposition(): void {
    const { anchorRect } = this.store.getState();
    if (anchorRect) this.updatePosition(anchorRect);
  }

  protected override shouldFocusOnShow(): boolean {
    // Pointer previews retain the source caret. Explicit autofocus below
    // targets the textarea rather than the base class's first button.
    return false;
  }

  protected onShow(state: FootnotePopupState): void {
    // Set label display
    this.labelSpan.textContent = `[^${state.label}]`;

    // Set textarea value
    this.textarea.value = state.content;

    // Configure goto button based on context
    if (this.openedOnReference) {
      // On reference - goto goes to definition
      const gotoLabel = i18n.t("editor:popup.footnote.goToDefinition");
      this.gotoBtn.title = gotoLabel;
      this.gotoBtn.setAttribute("aria-label", gotoLabel);
      this.gotoBtn.style.display = state.definitionPos !== null ? "flex" : "none";
    } else {
      // On definition - goto goes to reference
      const gotoLabel = i18n.t("editor:popup.footnote.goToReference");
      this.gotoBtn.title = gotoLabel;
      this.gotoBtn.setAttribute("aria-label", gotoLabel);
      /* v8 ignore next -- @preserve reason: footnote definition without a reference is an edge case */
      this.gotoBtn.style.display = state.referencePos !== null ? "flex" : "none";
    }

    // The base positions before onShow; re-position now that content is in.
    this.reposition();

    if (state.autoFocus) {
      requestAnimationFrame(() => {
        if (!this.isVisible() || !this.store.getState().autoFocus) return;
        this.textarea.focus();
        this.textarea.select();
      });
    }
  }

  protected onHide(): void {
    this.textarea.value = "";
    this.labelSpan.textContent = "";
    this.openedOnReference = true;
  }

  private autoResizeTextarea(): void {
    this.textarea.style.height = "auto";
    this.textarea.style.height = Math.min(this.textarea.scrollHeight, TEXTAREA_MAX_HEIGHT) + "px";
  }

  private handleTextareaInput(): void {
    this.store.getState().setContent(this.textarea.value);
    // Typing can change the height; re-anchor so the popup keeps its gap.
    this.reposition();
  }

  private handleTextareaKeydown(e: KeyboardEvent): void {
    // The Enter that confirms an IME candidate is not a save.
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSave();
    }
    // Escape is handled by base class
  }

  private handleSave(): void {
    saveFootnoteContent(this.editorView, this.store);
    this.closePopup();
    this.focusEditor();
  }

  private handleGoto(): void {
    gotoFootnoteTarget(this.editorView, this.openedOnReference, this.store);
    this.closePopup();
    this.focusEditor();
  }

  private handleDelete(): void {
    removeFootnote(this.editorView, this.store);
    this.closePopup();
    this.focusEditor();
  }

  public setOpenedOnReference(value: boolean): void {
    this.openedOnReference = value;
  }
}
