/**
 * Footnote Popup View
 *
 * Manages the DOM for the footnote hover popup with inline editing.
 * Similar to LinkPopupView - allows editing footnote content directly.
 */

import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { handlePopupTabNavigation } from "@/utils/popupComponents";
import type { EditorView } from "@tiptap/pm/view";
import { scrollToPosition } from "./tiptapDomUtils";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";
import {
  AUTOFOCUS_DELAY_MS,
  BLUR_CHECK_DELAY_MS,
  DEFAULT_POPUP_HEIGHT,
  DEFAULT_POPUP_WIDTH,
  POPUP_GAP_PX,
  TEXTAREA_MAX_HEIGHT,
  createFootnotePopupDom,
} from "./footnotePopupDom";

export class FootnotePopupView {
  private container: HTMLDivElement;
  private textarea: HTMLTextAreaElement;
  private view: EditorView;
  private unsubscribe: () => void;
  private justOpened = false;
  private wasOpen = false;
  private lastLabel = "";
  private lastAutoFocus = false;
  private focusTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private blurTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private host: HTMLElement | null = null;

  constructor(view: EditorView) {
    this.view = view;

    const dom = createFootnotePopupDom({
      onInputChange: this.handleInputChange,
      onInputKeydown: this.handleInputKeydown,
      onTextareaClick: this.handleTextareaClick,
      onTextareaBlur: this.handleTextareaBlur,
      onGoto: this.handleGoto,
      onSave: this.handleSave,
      onDelete: this.handleDelete,
    });
    this.container = dom.container;
    this.textarea = dom.textarea;

    // Container will be appended to host in show()

    // Handle mouse leave from popup (only when not editing)
    this.container.addEventListener("mouseleave", this.handlePopupMouseLeave);

    // Handle click outside
    document.addEventListener("mousedown", this.handleClickOutside);

    // Subscribe to store - show() on open transition, label change, or autoFocus change
    this.unsubscribe = useFootnotePopupStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        // Show on open transition, label change, or autoFocus becoming true
        const needsShow =
          !this.wasOpen ||
          state.label !== this.lastLabel ||
          (state.autoFocus && !this.lastAutoFocus);

        if (needsShow) {
          this.show(state.content, state.anchorRect, state.definitionPos);
        }
        this.wasOpen = true;
        this.lastLabel = state.label;
        this.lastAutoFocus = state.autoFocus;
      } else {
        this.hide();
        this.wasOpen = false;
        this.lastLabel = "";
        this.lastAutoFocus = false;
      }
    });

    // Initial state
    const state = useFootnotePopupStore.getState();
    if (state.isOpen && state.anchorRect) {
      this.show(state.content, state.anchorRect, state.definitionPos);
      this.lastLabel = state.label;
      this.lastAutoFocus = state.autoFocus;
    }
  }

  private show(content: string, anchorRect: DOMRect, definitionPos: number | null) {
    const state = useFootnotePopupStore.getState();

    this.textarea.value = content;

    // Mount to editor container if available, otherwise document.body
    this.host = getPopupHostForDom(this.view.dom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    const gotoBtn = this.container.querySelector(".footnote-popup-btn-goto") as HTMLElement;
    if (gotoBtn) gotoBtn.style.display = definitionPos !== null ? "flex" : "none";

    this.justOpened = true;
    requestAnimationFrame(() => { this.justOpened = false; });

    this.updatePosition(anchorRect);
    this.autoResizeTextarea();

    this.setupKeyboardNavigation();

    if (state.autoFocus) {
      this.container.classList.add("editing");
      this.clearFocusTimeout();
      this.focusTimeoutId = setTimeout(() => {
        // Only focus if popup is still open
        if (useFootnotePopupStore.getState().isOpen) {
          this.textarea.focus();
          this.textarea.select();
        }
      }, AUTOFOCUS_DELAY_MS);
    }
  }

  private hide() {
    this.container.style.display = "none";
    this.host = null;
    this.clearFocusTimeout();
    this.clearBlurTimeout();
    this.removeKeyboardNavigation();
  }

  private clearFocusTimeout() {
    if (this.focusTimeoutId) {
      clearTimeout(this.focusTimeoutId);
      this.focusTimeoutId = null;
    }
  }

  private clearBlurTimeout() {
    if (this.blurTimeoutId) {
      clearTimeout(this.blurTimeoutId);
      this.blurTimeoutId = null;
    }
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

  private updatePosition(anchorRect: DOMRect) {
    const containerEl = this.view.dom.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.view.dom as HTMLElement, containerEl)
      : getViewportBounds();
    const anchor: AnchorRect = {
      top: anchorRect.top, left: anchorRect.left,
      bottom: anchorRect.bottom, right: anchorRect.right,
    };
    const popupRect = this.container.getBoundingClientRect();
    const position = calculatePopupPosition({
      anchor,
      popup: { width: popupRect.width || DEFAULT_POPUP_WIDTH, height: popupRect.height || DEFAULT_POPUP_HEIGHT },
      bounds, gap: POPUP_GAP_PX, preferAbove: true,
    });

    // Convert to host-relative coordinates if mounted inside editor container
    if (this.host !== document.body && this.host) {
      const hostPos = toHostCoordsForDom(this.host, { top: position.top, left: position.left });
      this.container.style.left = `${hostPos.left}px`;
      this.container.style.top = `${hostPos.top}px`;
    } else {
      this.container.style.left = `${position.left}px`;
      this.container.style.top = `${position.top}px`;
    }
  }

  private autoResizeTextarea() {
    this.textarea.style.height = "auto";
    this.textarea.style.height = Math.min(this.textarea.scrollHeight, TEXTAREA_MAX_HEIGHT) + "px";
  }

  private handleInputChange = () => {
    useFootnotePopupStore.getState().setContent(this.textarea.value);
    this.autoResizeTextarea();
  };

  private handleInputKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.handleSave(); }
    else if (e.key === "Escape") {
      e.preventDefault();
      useFootnotePopupStore.getState().closePopup();
      this.view.focus();
    }
  };

  private handleTextareaClick = () => {
    this.container.classList.add("editing");
    this.textarea.focus();
  };

  private handleTextareaBlur = () => {
    this.clearBlurTimeout();
    this.blurTimeoutId = setTimeout(() => {
      if (!this.container.contains(document.activeElement)) this.container.classList.remove("editing");
    }, BLUR_CHECK_DELAY_MS);
  };

  /** Close popup and return focus to editor */
  private closeAndFocus() {
    useFootnotePopupStore.getState().closePopup();
    this.view.focus();
  }

  private handleSave = () => {
    const state = useFootnotePopupStore.getState();
    const { content, definitionPos, label } = state;

    if (definitionPos === null) {
      this.closeAndFocus();
      return;
    }

    try {
      const { state: editorState, dispatch } = this.view;
      const node = editorState.doc.nodeAt(definitionPos);

      // Verify node is still a footnote_definition with matching label
      if (!node || node.type.name !== "footnote_definition") {
        console.warn("[FootnotePopup] Definition node not found at position, may have moved");
        this.closeAndFocus();
        return;
      }

      if (node.attrs.label !== label) {
        console.warn("[FootnotePopup] Definition label mismatch, document may have changed");
        this.closeAndFocus();
        return;
      }

      // Create a text node with the new content
      const schema = editorState.schema;
      const textNode = schema.text(content);
      const paragraph = schema.nodes.paragraph.create(null, textNode);

      // Replace the content of the footnote definition
      // The structure is: footnote_definition > paragraph > text
      const contentStart = definitionPos + 1;
      const contentEnd = definitionPos + node.nodeSize - 1;

      const tr = editorState.tr.replaceWith(contentStart, contentEnd, paragraph);
      dispatch(tr);

      this.closeAndFocus();
    } catch (error) {
      console.error("[FootnotePopup] Save failed:", error);
      this.closeAndFocus();
    }
  };

  private handleGoto = () => {
    const { definitionPos } = useFootnotePopupStore.getState();
    if (definitionPos !== null) {
      scrollToPosition(this.view, definitionPos);
      this.closeAndFocus();
    }
  };

  private handleDelete = () => {
    const state = useFootnotePopupStore.getState();
    const { referencePos, definitionPos } = state;

    if (referencePos === null) {
      this.closeAndFocus();
      return;
    }

    try {
      const { state: editorState, dispatch } = this.view;

      // Delete reference first, then definition (in reverse order to preserve positions)
      // We need to delete from the end to preserve positions
      let tr = editorState.tr;

      // Get node sizes before deletion
      const refNode = editorState.doc.nodeAt(referencePos);
      if (!refNode || refNode.type.name !== "footnote_reference") {
        console.warn("[FootnotePopup] Reference node not found at position");
        this.closeAndFocus();
        return;
      }

      // Delete definition first if it exists (it's typically at the end of doc)
      if (definitionPos !== null) {
        const defNode = editorState.doc.nodeAt(definitionPos);
        if (defNode && defNode.type.name === "footnote_definition") {
          // Definition is after reference, delete it first
          if (definitionPos > referencePos) {
            tr = tr.delete(definitionPos, definitionPos + defNode.nodeSize);
            tr = tr.delete(referencePos, referencePos + refNode.nodeSize);
          } else {
            // Definition is before reference (unusual but handle it)
            tr = tr.delete(referencePos, referencePos + refNode.nodeSize);
            tr = tr.delete(definitionPos, definitionPos + defNode.nodeSize);
          }
        } else {
          // Definition not found, just delete reference
          tr = tr.delete(referencePos, referencePos + refNode.nodeSize);
        }
      } else {
        // No definition, just delete reference
        tr = tr.delete(referencePos, referencePos + refNode.nodeSize);
      }

      dispatch(tr);
      this.closeAndFocus();
    } catch (error) {
      console.error("[FootnotePopup] Delete failed:", error);
      this.closeAndFocus();
    }
  };

  private handlePopupMouseLeave = () => {
    if (!this.container.classList.contains("editing")) {
      useFootnotePopupStore.getState().closePopup();
    }
  };

  private handleClickOutside = (e: MouseEvent) => {
    if (this.justOpened) return;

    const { isOpen } = useFootnotePopupStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      useFootnotePopupStore.getState().closePopup();
    }
  };

  update() {
    const state = useFootnotePopupStore.getState();
    if (state.isOpen && state.anchorRect) {
      this.updatePosition(state.anchorRect);
    }
  }

  destroy() {
    this.clearFocusTimeout();
    this.clearBlurTimeout();
    this.removeKeyboardNavigation();
    this.unsubscribe();
    this.container.removeEventListener("mouseleave", this.handlePopupMouseLeave);
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}
