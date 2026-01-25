/**
 * Source Image Popup View
 *
 * Popup view for editing images in Source mode (CodeMirror 6).
 * Allows editing image src and alt text.
 */

import type { EditorView } from "@codemirror/view";
import { SourcePopupView, type StoreApi } from "@/plugins/sourcePopup";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { popupIcons } from "@/utils/popupComponents";
import { browseImage, copyImagePath, removeImage, saveImageChanges } from "./sourceImageActions";

/**
 * Source image popup view.
 * Extends the base SourcePopupView for common functionality.
 */
type ImagePopupStoreState = ReturnType<typeof useImagePopupStore.getState>;

export class SourceImagePopupView extends SourcePopupView<ImagePopupStoreState> {
  // Use 'declare' to avoid ES2022 class field initialization overwriting values set in buildContainer()
  private declare srcInput: HTMLInputElement;
  private declare altInput: HTMLInputElement;

  constructor(view: EditorView, store: StoreApi<ImagePopupStoreState>) {
    super(view, store);
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "source-image-popup";

    // Row 1: Source input + buttons
    const srcRow = document.createElement("div");
    srcRow.className = "source-image-popup-row";

    this.srcInput = document.createElement("input");
    this.srcInput.type = "text";
    this.srcInput.className = "source-image-popup-src";
    this.srcInput.placeholder = "Image URL or path...";
    this.srcInput.addEventListener("keydown", this.handleInputKeydown.bind(this));
    this.srcInput.addEventListener("input", this.handleSrcInput.bind(this));

    // Icon buttons: browse, copy, delete
    const browseBtn = this.buildIconButton(popupIcons.folder, "Browse local file", this.handleBrowse.bind(this));
    const copyBtn = this.buildIconButton(popupIcons.copy, "Copy path", this.handleCopy.bind(this));
    const deleteBtn = this.buildIconButton(popupIcons.delete, "Remove image", this.handleRemove.bind(this));
    deleteBtn.classList.add("source-image-popup-btn-delete");

    srcRow.appendChild(this.srcInput);
    srcRow.appendChild(browseBtn);
    srcRow.appendChild(copyBtn);
    srcRow.appendChild(deleteBtn);

    // Row 2: Caption/alt input
    const altRow = document.createElement("div");
    altRow.className = "source-image-popup-row";

    this.altInput = document.createElement("input");
    this.altInput.type = "text";
    this.altInput.className = "source-image-popup-alt";
    this.altInput.placeholder = "Caption (alt text)...";
    this.altInput.addEventListener("keydown", this.handleInputKeydown.bind(this));
    this.altInput.addEventListener("input", this.handleAltInput.bind(this));

    altRow.appendChild(this.altInput);

    container.appendChild(srcRow);
    container.appendChild(altRow);

    return container;
  }

  protected getPopupDimensions() {
    return {
      width: 340,
      height: 72,
      gap: 6,
      preferAbove: true,
    };
  }

  protected onShow(state: ImagePopupStoreState): void {
    // Set input values from store
    this.srcInput.value = state.imageSrc;
    this.altInput.value = state.imageAlt;

    // Focus src input after a brief delay
    requestAnimationFrame(() => {
      this.srcInput.focus();
      this.srcInput.select();
    });
  }

  protected onHide(): void {
    // Clear inputs
    this.srcInput.value = "";
    this.altInput.value = "";
  }

  private buildIconButton(iconSvg: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "source-image-popup-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    }
    // Escape is handled by base class
  }

  private handleSrcInput(): void {
    useImagePopupStore.getState().setSrc(this.srcInput.value);
  }

  private handleAltInput(): void {
    useImagePopupStore.getState().setAlt(this.altInput.value);
  }

  private handleSave(): void {
    saveImageChanges(this.editorView);
    this.closePopup();
    this.focusEditor();
  }

  private handleBrowse(): void {
    browseImage(this.editorView);
  }

  private handleCopy(): void {
    copyImagePath();
  }

  private handleRemove(): void {
    removeImage(this.editorView);
    this.closePopup();
    this.focusEditor();
  }
}
