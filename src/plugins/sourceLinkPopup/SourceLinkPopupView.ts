/**
 * Source Link Popup View
 *
 * Popup view for editing links in Source mode (CodeMirror 6).
 * Allows editing link URL, opening, copying, and removing links.
 */

import type { EditorView } from "@codemirror/view";
import { SourcePopupView, type StoreApi } from "@/plugins/sourcePopup";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { popupIcons } from "@/utils/popupComponents";
import { copyLinkHref, openLink, removeLink, saveLinkChanges } from "./sourceLinkActions";

/**
 * Source link popup view.
 * Extends the base SourcePopupView for common functionality.
 */
type LinkPopupStoreState = ReturnType<typeof useLinkPopupStore.getState>;

export class SourceLinkPopupView extends SourcePopupView<LinkPopupStoreState> {
  // Use 'declare' to avoid ES2022 class field initialization overwriting values set in buildContainer()
  private declare hrefInput: HTMLInputElement;
  private declare openBtn: HTMLElement;
  private isBookmark = false;

  constructor(view: EditorView, store: StoreApi<LinkPopupStoreState>) {
    super(view, store);
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "source-link-popup";

    // Row 1: URL input + buttons
    const hrefRow = document.createElement("div");
    hrefRow.className = "source-link-popup-row";

    this.hrefInput = document.createElement("input");
    this.hrefInput.type = "text";
    this.hrefInput.className = "source-link-popup-href";
    this.hrefInput.placeholder = "URL...";
    this.hrefInput.autocapitalize = "off";
    this.hrefInput.autocomplete = "off";
    this.hrefInput.spellcheck = false;
    this.hrefInput.setAttribute("autocorrect", "off");
    this.hrefInput.addEventListener("keydown", this.handleInputKeydown.bind(this));
    this.hrefInput.addEventListener("input", this.handleHrefInput.bind(this));

    // Icon buttons: open, copy, delete
    this.openBtn = this.buildIconButton(popupIcons.open, "Open link", this.handleOpen.bind(this));
    this.openBtn.classList.add("source-link-popup-btn-open");
    const copyBtn = this.buildIconButton(popupIcons.copy, "Copy URL", this.handleCopy.bind(this));
    const deleteBtn = this.buildIconButton(popupIcons.delete, "Remove link", this.handleRemove.bind(this));
    deleteBtn.classList.add("source-link-popup-btn-delete");

    hrefRow.appendChild(this.hrefInput);
    hrefRow.appendChild(this.openBtn);
    hrefRow.appendChild(copyBtn);
    hrefRow.appendChild(deleteBtn);

    container.appendChild(hrefRow);

    return container;
  }

  protected getPopupDimensions() {
    return {
      width: 340,
      height: 40,
      gap: 6,
      preferAbove: true,
    };
  }

  protected onShow(state: LinkPopupStoreState): void {
    this.isBookmark = state.href.startsWith("#");

    // Set input values from store
    this.hrefInput.value = state.href;

    // Configure for bookmark vs regular link
    if (this.isBookmark) {
      // Bookmark: disable href input, update open button title
      this.hrefInput.disabled = true;
      this.hrefInput.classList.add("disabled");
      this.openBtn.title = "Go to heading";
    } else {
      // Regular link: enable href input
      this.hrefInput.disabled = false;
      this.hrefInput.classList.remove("disabled");
      this.openBtn.title = "Open link";
    }

    // Focus appropriate input (base class has already blurred the editor)
    requestAnimationFrame(() => {
      if (this.isBookmark) {
        this.openBtn.focus();
      } else {
        this.hrefInput.focus();
        this.hrefInput.select();
      }
    });
  }

  protected onHide(): void {
    // Clear inputs
    this.hrefInput.value = "";
    this.hrefInput.disabled = false;
    this.hrefInput.classList.remove("disabled");
    this.isBookmark = false;
  }

  private buildIconButton(iconSvg: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "source-link-popup-btn";
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

  private handleHrefInput(): void {
    useLinkPopupStore.getState().setHref(this.hrefInput.value);
  }

  private handleSave(): void {
    const { href } = useLinkPopupStore.getState();

    if (!href.trim()) {
      // Empty URL - remove the link
      this.handleRemove();
      return;
    }

    saveLinkChanges(this.editorView);
    this.closePopup();
    this.focusEditor();
  }

  private handleOpen(): void {
    openLink(this.editorView);
  }

  private handleCopy(): void {
    copyLinkHref();
  }

  private handleRemove(): void {
    removeLink(this.editorView);
    this.closePopup();
    this.focusEditor();
  }
}
