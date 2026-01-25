/**
 * Source Link Create Popup View
 *
 * Popup for creating new links in Source mode (CodeMirror 6).
 * Shows text + URL inputs when no selection, or just URL input when text is selected.
 */

import type { EditorView } from "@codemirror/view";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
} from "@/utils/popupPosition";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { popupIcons } from "@/utils/popupComponents";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

/**
 * Source link create popup view - manages the floating popup UI for creating links.
 */
export class SourceLinkCreatePopupView {
  private container: HTMLElement;
  private textInput: HTMLInputElement | null = null;
  private urlInput: HTMLInputElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private justOpened = false;
  private wasOpen = false;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private host: HTMLElement | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    // Build DOM structure
    this.container = document.createElement("div");
    this.container.className = "link-create-popup";
    this.container.style.display = "none";
    this.urlInput = document.createElement("input");

    // Subscribe to store changes
    this.unsubscribe = useLinkCreatePopupStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        if (!this.wasOpen) {
          this.show(state);
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });

    // Handle click outside
    document.addEventListener("mousedown", this.handleClickOutside);

    // Close popup on scroll
    this.editorView.dom.closest(".editor-container")?.addEventListener("scroll", this.handleScroll, true);
  }

  private buildContainer(showTextInput: boolean): void {
    this.container.innerHTML = "";

    if (showTextInput) {
      const textRow = document.createElement("div");
      textRow.className = "link-create-popup-row";

      this.textInput = document.createElement("input");
      this.textInput.type = "text";
      this.textInput.className = "link-create-popup-input link-create-popup-text";
      this.textInput.placeholder = "Link text...";
      this.textInput.autocapitalize = "off";
      this.textInput.autocomplete = "off";
      this.textInput.spellcheck = false;
      this.textInput.addEventListener("input", this.handleTextInput);
      this.textInput.addEventListener("keydown", this.handleInputKeydown);

      textRow.appendChild(this.textInput);
      this.container.appendChild(textRow);
    } else {
      this.textInput = null;
    }

    const urlRow = document.createElement("div");
    urlRow.className = "link-create-popup-row";

    this.urlInput = document.createElement("input");
    this.urlInput.type = "text";
    this.urlInput.className = "link-create-popup-input link-create-popup-url";
    this.urlInput.placeholder = "URL...";
    this.urlInput.autocapitalize = "off";
    this.urlInput.autocomplete = "off";
    this.urlInput.spellcheck = false;
    this.urlInput.setAttribute("autocorrect", "off");
    this.urlInput.addEventListener("input", this.handleUrlInput);
    this.urlInput.addEventListener("keydown", this.handleInputKeydown);

    const saveBtn = this.buildIconButton(popupIcons.save, "Create link", this.handleSave);
    saveBtn.classList.add("link-create-popup-btn-save");
    const cancelBtn = this.buildIconButton(popupIcons.close, "Cancel", this.handleCancel);
    cancelBtn.classList.add("link-create-popup-btn-cancel");

    urlRow.appendChild(this.urlInput);
    urlRow.appendChild(saveBtn);
    urlRow.appendChild(cancelBtn);

    this.container.appendChild(urlRow);
  }

  private buildIconButton(iconSvg: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "link-create-popup-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private getFocusableElements(): HTMLElement[] {
    return Array.from(
      this.container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
  }

  private setupKeyboardNavigation() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;

      if (e.key === "Tab") {
        const focusable = this.getFocusableElements();
        if (focusable.length === 0) return;

        const activeEl = document.activeElement as HTMLElement;
        const currentIndex = focusable.indexOf(activeEl);

        if (currentIndex === -1) return;

        e.preventDefault();

        if (e.shiftKey) {
          const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
          focusable[prevIndex].focus();
        } else {
          const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
          focusable[nextIndex].focus();
        }
      } else if (e.key === "Enter") {
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl && activeEl.tagName === "BUTTON" && this.container.contains(activeEl)) {
          e.preventDefault();
          activeEl.click();
        }
      } else if (e.key === "Escape") {
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl && this.container.contains(activeEl)) {
          e.preventDefault();
          useLinkCreatePopupStore.getState().closePopup();
          this.editorView.focus();
        }
      }
    };

    document.addEventListener("keydown", this.keydownHandler);
  }

  private removeKeyboardNavigation() {
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private show(state: ReturnType<typeof useLinkCreatePopupStore.getState>) {
    const { anchorRect, showTextInput, text } = state;
    if (!anchorRect) return;

    this.buildContainer(showTextInput);

    this.host = getPopupHostForDom(this.editorView.dom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    if (this.textInput) {
      this.textInput.value = text;
    }
    this.urlInput.value = "";

    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    const containerEl = this.editorView.dom.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    const popupHeight = showTextInput ? 72 : 36;
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: 320, height: popupHeight },
      bounds,
      gap: 6,
      preferAbove: true,
    });

    if (this.host !== document.body) {
      const hostPos = toHostCoordsForDom(this.host, { top, left });
      this.container.style.top = `${hostPos.top}px`;
      this.container.style.left = `${hostPos.left}px`;
    } else {
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
    }

    this.setupKeyboardNavigation();

    requestAnimationFrame(() => {
      if (this.textInput && showTextInput) {
        this.textInput.focus();
        this.textInput.select();
      } else {
        this.urlInput.focus();
      }
    });
  }

  private hide() {
    this.container.style.display = "none";
    this.host = null;
    this.removeKeyboardNavigation();
  }

  private handleTextInput = () => {
    if (this.textInput) {
      useLinkCreatePopupStore.getState().setText(this.textInput.value);
    }
  };

  private handleUrlInput = () => {
    useLinkCreatePopupStore.getState().setUrl(this.urlInput.value);
  };

  private handleInputKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      useLinkCreatePopupStore.getState().closePopup();
      this.editorView.focus();
    }
  };

  private handleSave = () => {
    const state = useLinkCreatePopupStore.getState();
    const { text, url, rangeFrom, rangeTo, showTextInput } = state;

    const finalUrl = url.trim();
    if (!finalUrl) {
      this.urlInput.focus();
      return;
    }

    const linkText = showTextInput ? (text.trim() || finalUrl) : null;

    try {
      let markdown: string;
      if (showTextInput) {
        // Insert [text](url)
        markdown = `[${linkText}](${finalUrl})`;
      } else {
        // Wrap existing text in [](url)
        const existingText = this.editorView.state.doc.sliceString(rangeFrom, rangeTo);
        markdown = `[${existingText}](${finalUrl})`;
      }

      this.editorView.dispatch({
        changes: { from: rangeFrom, to: rangeTo, insert: markdown },
        selection: { anchor: rangeFrom + markdown.length },
      });

      useLinkCreatePopupStore.getState().closePopup();
      this.editorView.focus();
    } catch (error) {
      console.error("[SourceLinkCreatePopup] Save failed:", error);
      useLinkCreatePopupStore.getState().closePopup();
    }
  };

  private handleCancel = () => {
    useLinkCreatePopupStore.getState().closePopup();
    this.editorView.focus();
  };

  private handleClickOutside = (e: MouseEvent) => {
    if (this.justOpened) return;

    const { isOpen } = useLinkCreatePopupStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      useLinkCreatePopupStore.getState().closePopup();
    }
  };

  private handleScroll = () => {
    const { isOpen } = useLinkCreatePopupStore.getState();
    if (isOpen) {
      useLinkCreatePopupStore.getState().closePopup();
    }
  };

  destroy() {
    this.unsubscribe();
    this.removeKeyboardNavigation();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.editorView.dom.closest(".editor-container")?.removeEventListener("scroll", this.handleScroll, true);
    this.container.remove();
  }
}
