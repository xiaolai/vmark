/**
 * Wiki Embed Popup View
 *
 * DOM management for editing wiki embed target.
 * Uses icon buttons and borderless inputs for consistent popup design.
 */

import type { EditorView } from "@tiptap/pm/view";
import { useWikiEmbedPopupStore } from "@/stores/wikiEmbedPopupStore";
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

const DEFAULT_POPUP_WIDTH = 320;
const DEFAULT_POPUP_HEIGHT = 60;

export class WikiEmbedPopupView {
  private container: HTMLElement;
  private targetInput: HTMLInputElement;
  private preview: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private justOpened = false;
  private wasOpen = false;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    this.container = this.buildContainer();
    this.targetInput = this.container.querySelector(
      ".wiki-embed-popup-target"
    ) as HTMLInputElement;
    this.preview = this.container.querySelector(
      ".wiki-embed-popup-preview"
    ) as HTMLElement;
    document.body.appendChild(this.container);

    this.unsubscribe = useWikiEmbedPopupStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        if (!this.wasOpen) {
          this.show(state.target, state.anchorRect);
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
    container.className = "wiki-embed-popup";
    container.style.display = "none";

    // Row 1: Target input + buttons
    const row = document.createElement("div");
    row.className = "wiki-embed-popup-row";

    const targetInput = buildPopupInput({
      placeholder: "Embed target",
      className: "wiki-embed-popup-target",
      onInput: this.handleTargetChange,
      onKeydown: this.handleInputKeydown,
    });

    // Button row
    const buttonRow = buildPopupButtonRow();

    const saveBtn = buildPopupIconButton({
      icon: "save",
      title: "Save",
      onClick: this.handleSave,
      variant: "primary",
    });

    const deleteBtn = buildPopupIconButton({
      icon: "delete",
      title: "Remove embed",
      onClick: this.handleDelete,
      variant: "danger",
    });

    buttonRow.appendChild(saveBtn);
    buttonRow.appendChild(deleteBtn);

    row.appendChild(targetInput);
    row.appendChild(buttonRow);

    // Preview
    const preview = buildPopupPreview("wiki-embed-popup-preview");

    container.appendChild(row);
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

  private show(target: string, anchorRect: AnchorRect) {
    this.targetInput.value = target;
    this.container.style.display = "flex";
    this.container.style.position = "fixed";

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
      gap: 6,
      preferAbove: true,
    });

    this.container.style.top = `${top}px`;
    this.container.style.left = `${left}px`;

    this.updatePreview(target);

    // Set up keyboard navigation
    this.setupKeyboardNavigation();

    requestAnimationFrame(() => {
      this.targetInput.focus();
      this.targetInput.select();
    });
  }

  private hide() {
    this.container.style.display = "none";
    this.removeKeyboardNavigation();
  }

  private updatePreview(target: string) {
    const trimmed = target.trim();
    this.preview.textContent = trimmed ? `![[${trimmed}]]` : "";
  }

  private handleTargetChange = (value: string) => {
    useWikiEmbedPopupStore.getState().updateTarget(value);
    this.updatePreview(value);
  };

  private handleInputKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.handleCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSave();
    }
  };

  private handleSave = () => {
    const state = useWikiEmbedPopupStore.getState();
    const { nodePos } = state;
    const target = this.targetInput.value.trim();

    if (!target || nodePos === null) {
      state.closePopup();
      return;
    }

    const { state: editorState, dispatch } = this.editorView;
    const node = editorState.doc.nodeAt(nodePos);
    if (!node || node.type.name !== "wikiEmbed") {
      state.closePopup();
      return;
    }

    const attrs = {
      ...node.attrs,
      value: target,
    };
    const tr = editorState.tr.setNodeMarkup(nodePos, undefined, attrs);
    dispatch(tr);

    state.closePopup();
    this.editorView.focus();
  };

  private handleDelete = () => {
    const state = useWikiEmbedPopupStore.getState();
    const { nodePos } = state;

    if (nodePos === null) {
      state.closePopup();
      return;
    }

    const { state: editorState, dispatch } = this.editorView;
    const node = editorState.doc.nodeAt(nodePos);
    if (!node || node.type.name !== "wikiEmbed") {
      state.closePopup();
      return;
    }

    // Delete the wiki embed node
    const tr = editorState.tr.delete(nodePos, nodePos + node.nodeSize);
    dispatch(tr);

    state.closePopup();
    this.editorView.focus();
  };

  private handleCancel = () => {
    useWikiEmbedPopupStore.getState().closePopup();
    this.editorView.focus();
  };

  private handleClickOutside = (e: MouseEvent) => {
    if (this.justOpened) return;
    const { isOpen } = useWikiEmbedPopupStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      useWikiEmbedPopupStore.getState().closePopup();
    }
  };

  destroy() {
    this.unsubscribe();
    this.removeKeyboardNavigation();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}
