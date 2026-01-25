/**
 * Source Footnote Popup View
 *
 * Popup view for editing footnotes in Source mode (CodeMirror 6).
 * Shows label, textarea for content, goto/save/delete buttons.
 */

import type { EditorView } from "@codemirror/view";
import { SourcePopupView, type StoreApi } from "@/plugins/sourcePopup";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { popupIcons } from "@/utils/popupComponents";
import {
  saveFootnoteContent,
  gotoFootnoteTarget,
  removeFootnote,
} from "./sourceFootnoteActions";

const TEXTAREA_MAX_HEIGHT = 120;

/**
 * Source footnote popup view.
 * Extends the base SourcePopupView for common functionality.
 */
type FootnotePopupStoreState = ReturnType<typeof useFootnotePopupStore.getState>;

export class SourceFootnotePopupView extends SourcePopupView<FootnotePopupStoreState> {
  // Use 'declare' to avoid ES2022 class field initialization overwriting values set in buildContainer()
  private declare labelSpan: HTMLSpanElement;
  private declare textarea: HTMLTextAreaElement;
  private declare gotoBtn: HTMLButtonElement;
  private openedOnReference = true;

  constructor(view: EditorView, store: StoreApi<FootnotePopupStoreState>) {
    super(view, store);
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "source-footnote-popup";

    // Row 1: Label display + buttons
    const headerRow = document.createElement("div");
    headerRow.className = "source-footnote-popup-header";

    this.labelSpan = document.createElement("span");
    this.labelSpan.className = "source-footnote-popup-label";

    const spacer = document.createElement("div");
    spacer.style.flex = "1";

    this.gotoBtn = this.buildIconButton(popupIcons.goto, "Go to definition", this.handleGoto.bind(this));
    this.gotoBtn.classList.add("source-footnote-popup-btn-goto");
    const saveBtn = this.buildIconButton(popupIcons.save, "Save (Enter)", this.handleSave.bind(this));
    saveBtn.classList.add("source-footnote-popup-btn-save");
    const deleteBtn = this.buildIconButton(popupIcons.delete, "Remove footnote", this.handleDelete.bind(this));
    deleteBtn.classList.add("source-footnote-popup-btn-delete");

    headerRow.appendChild(this.labelSpan);
    headerRow.appendChild(spacer);
    headerRow.appendChild(this.gotoBtn);
    headerRow.appendChild(saveBtn);
    headerRow.appendChild(deleteBtn);

    // Row 2: Textarea for content
    this.textarea = document.createElement("textarea");
    this.textarea.className = "source-footnote-popup-textarea";
    this.textarea.placeholder = "Footnote content...";
    this.textarea.rows = 2;
    this.textarea.addEventListener("input", this.handleTextareaInput.bind(this));
    this.textarea.addEventListener("keydown", this.handleTextareaKeydown.bind(this));

    container.appendChild(headerRow);
    container.appendChild(this.textarea);

    return container;
  }

  protected getPopupDimensions() {
    return {
      width: 300,
      height: 100,
      gap: 6,
      preferAbove: true,
    };
  }

  protected onShow(state: FootnotePopupStoreState): void {
    // Set label display
    this.labelSpan.textContent = `[^${state.label}]`;

    // Set textarea value
    this.textarea.value = state.content;
    this.autoResizeTextarea();

    // Configure goto button based on context
    if (this.openedOnReference) {
      // On reference - goto goes to definition
      this.gotoBtn.title = "Go to definition";
      this.gotoBtn.style.display = state.definitionPos !== null ? "flex" : "none";
    } else {
      // On definition - goto goes to reference
      this.gotoBtn.title = "Go to reference";
      this.gotoBtn.style.display = state.referencePos !== null ? "flex" : "none";
    }

    // Focus textarea after brief delay
    requestAnimationFrame(() => {
      this.textarea.focus();
      this.textarea.select();
    });
  }

  protected onHide(): void {
    this.textarea.value = "";
    this.labelSpan.textContent = "";
    this.openedOnReference = true;
  }

  private buildIconButton(iconSvg: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "source-footnote-popup-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private autoResizeTextarea(): void {
    this.textarea.style.height = "auto";
    this.textarea.style.height = Math.min(this.textarea.scrollHeight, TEXTAREA_MAX_HEIGHT) + "px";
  }

  private handleTextareaInput(): void {
    useFootnotePopupStore.getState().setContent(this.textarea.value);
    this.autoResizeTextarea();
  }

  private handleTextareaKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSave();
    }
    // Escape is handled by base class
  }

  private handleSave(): void {
    saveFootnoteContent(this.editorView);
    this.closePopup();
    this.focusEditor();
  }

  private handleGoto(): void {
    gotoFootnoteTarget(this.editorView, this.openedOnReference);
    this.closePopup();
    this.focusEditor();
  }

  private handleDelete(): void {
    removeFootnote(this.editorView);
    this.closePopup();
    this.focusEditor();
  }

  public setOpenedOnReference(value: boolean): void {
    this.openedOnReference = value;
  }
}
