/**
 * Reference Popup View
 *
 * DOM management for inserting reference links.
 * Uses icon buttons and borderless inputs for consistent popup design.
 */

import { useLinkReferenceDialogStore } from "@/stores/linkReferenceDialogStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { isImeKeyEvent } from "@/utils/imeGuard";
import {
  buildPopupIconButton,
  buildPopupInput,
  buildPopupPreview,
  buildPopupButtonRow,
  handlePopupTabNavigation,
} from "@/utils/popupComponents";

const DEFAULT_POPUP_WIDTH = 360;
const DEFAULT_POPUP_HEIGHT = 120;

type EditorViewLike = {
  dom: HTMLElement;
  focus: () => void;
};

export class ReferencePopupView {
  private container: HTMLElement;
  private identifierInput: HTMLInputElement;
  private urlInput: HTMLInputElement;
  private titleInput: HTMLInputElement;
  private preview: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorViewLike;
  private justOpened = false;
  private wasOpen = false;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(view: EditorViewLike) {
    this.editorView = view;

    this.container = this.buildContainer();
    this.identifierInput = this.container.querySelector(
      ".reference-popup-identifier"
    ) as HTMLInputElement;
    this.urlInput = this.container.querySelector(
      ".reference-popup-url"
    ) as HTMLInputElement;
    this.titleInput = this.container.querySelector(
      ".reference-popup-title"
    ) as HTMLInputElement;
    this.preview = this.container.querySelector(
      ".reference-popup-preview"
    ) as HTMLElement;
    document.body.appendChild(this.container);

    this.unsubscribe = useLinkReferenceDialogStore.subscribe((state) => {
      if (state.isOpen) {
        if (!this.wasOpen) {
          this.show(state.selectedText, state.anchorRect);
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
    container.className = "reference-popup";
    container.style.display = "none";

    // Row 1: Identifier + URL inputs
    const row1 = document.createElement("div");
    row1.className = "reference-popup-row";

    const identifierInput = buildPopupInput({
      placeholder: "Identifier",
      className: "reference-popup-identifier",
      onInput: this.handleIdentifierChange,
      onKeydown: this.handleInputKeydown,
    });

    const urlInput = buildPopupInput({
      placeholder: "URL",
      monospace: true,
      className: "reference-popup-url",
      onInput: this.handleUrlChange,
      onKeydown: this.handleInputKeydown,
    });

    row1.appendChild(identifierInput);
    row1.appendChild(urlInput);

    // Row 2: Title input + buttons
    const row2 = document.createElement("div");
    row2.className = "reference-popup-row";

    const titleInput = buildPopupInput({
      placeholder: "Title (optional)",
      className: "reference-popup-title",
      onInput: this.handleTitleChange,
      onKeydown: this.handleInputKeydown,
    });

    // Button row
    const buttonRow = buildPopupButtonRow();

    const saveBtn = buildPopupIconButton({
      icon: "save",
      title: "Insert reference link",
      onClick: this.handleInsert,
      variant: "primary",
    });

    const closeBtn = buildPopupIconButton({
      icon: "close",
      title: "Cancel",
      onClick: this.handleClose,
    });

    buttonRow.appendChild(saveBtn);
    buttonRow.appendChild(closeBtn);

    row2.appendChild(titleInput);
    row2.appendChild(buttonRow);

    // Preview
    const preview = buildPopupPreview("reference-popup-preview");

    container.appendChild(row1);
    container.appendChild(row2);
    container.appendChild(preview);

    return container;
  }

  private setupKeyboardNavigation() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      handlePopupTabNavigation(e, this.container);
    };
    document.addEventListener("keydown", this.keydownHandler);
  }

  private removeKeyboardNavigation() {
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private show(selectedText: string, anchorRect: AnchorRect | null) {
    // Seed identifier from selected text
    const identifier = selectedText
      ? selectedText.toLowerCase().replace(/\s+/g, "-")
      : "";
    this.identifierInput.value = identifier;
    this.urlInput.value = "";
    this.titleInput.value = "";

    this.container.style.display = "flex";
    this.container.style.position = "fixed";

    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    // Calculate position
    const containerEl = this.editorView.dom.closest(
      ".editor-container"
    ) as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    // If no anchor rect provided, position near the center-top of editor
    const anchor: AnchorRect = anchorRect ?? {
      top: bounds.vertical.top + 100,
      bottom: bounds.vertical.top + 120,
      left: (bounds.horizontal.left + bounds.horizontal.right) / 2 - DEFAULT_POPUP_WIDTH / 2,
      right: (bounds.horizontal.left + bounds.horizontal.right) / 2 + DEFAULT_POPUP_WIDTH / 2,
    };

    const popupRect = this.container.getBoundingClientRect();
    const { top, left } = calculatePopupPosition({
      anchor,
      popup: {
        width: popupRect.width || DEFAULT_POPUP_WIDTH,
        height: popupRect.height || DEFAULT_POPUP_HEIGHT,
      },
      bounds,
      gap: 6,
      preferAbove: false,
    });

    this.container.style.top = `${top}px`;
    this.container.style.left = `${left}px`;

    this.updatePreview(selectedText);

    // Set up keyboard navigation
    this.setupKeyboardNavigation();

    requestAnimationFrame(() => {
      this.identifierInput.focus();
      this.identifierInput.select();
    });
  }

  private hide() {
    this.container.style.display = "none";
    this.removeKeyboardNavigation();
  }

  private updatePreview(selectedText?: string) {
    const identifier = this.identifierInput.value.trim();
    const url = this.urlInput.value.trim();
    const title = this.titleInput.value.trim();
    const text = selectedText ?? (useLinkReferenceDialogStore.getState().selectedText || "text");

    if (!identifier && !url) {
      this.preview.textContent = "";
      return;
    }

    const refPart = `[${text}][${identifier || "ref"}]`;
    const defPart = `[${identifier || "ref"}]: ${url || "url"}${title ? ` "${title}"` : ""}`;
    this.preview.textContent = `${refPart} → ${defPart}`;
  }

  private handleIdentifierChange = () => {
    this.updatePreview();
  };

  private handleUrlChange = () => {
    this.updatePreview();
  };

  private handleTitleChange = () => {
    this.updatePreview();
  };

  private handleInputKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.handleClose();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleInsert();
    }
  };

  private handleInsert = () => {
    const identifier = this.identifierInput.value.trim();
    const url = this.urlInput.value.trim();
    const title = this.titleInput.value.trim();

    if (!identifier || !url) {
      return;
    }

    useLinkReferenceDialogStore.getState().insert(identifier, url, title);
    this.editorView.focus();
  };

  private handleClose = () => {
    useLinkReferenceDialogStore.getState().closeDialog();
    this.editorView.focus();
  };

  private handleClickOutside = (e: MouseEvent) => {
    if (this.justOpened) return;
    const { isOpen } = useLinkReferenceDialogStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      useLinkReferenceDialogStore.getState().closeDialog();
    }
  };

  destroy() {
    this.unsubscribe();
    this.removeKeyboardNavigation();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}
