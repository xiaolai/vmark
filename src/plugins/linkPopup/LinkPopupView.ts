/**
 * Link Popup View
 *
 * DOM management for the link editing popup.
 * Shows when clicking on a link, allows editing/opening/copying/removing.
 */

import { TextSelection } from "@tiptap/pm/state";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { findHeadingById } from "@/utils/headingSlug";
import { isImeKeyEvent } from "@/utils/imeGuard";

type EditorViewLike = {
  dom: HTMLElement;
  // We keep this structural because ProseMirror’s internal types are nominal across packages.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (tr: any) => void;
  focus: () => void;
};

// SVG Icons (matching project style)
const icons = {
  open: `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  save: `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  delete: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
};

/**
 * Link popup view - manages the floating popup UI.
 */
export class LinkPopupView {
  private container: HTMLElement;
  private input: HTMLInputElement;
  private openBtn: HTMLElement;
  private saveBtn: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorViewLike;
  private justOpened = false;
  private wasOpen = false;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(view: EditorViewLike) {
    this.editorView = view;

    // Build DOM structure
    this.container = this.buildContainer();
    this.input = this.container.querySelector(
      ".link-popup-input"
    ) as HTMLInputElement;
    this.openBtn = this.container.querySelector(
      ".link-popup-btn-open"
    ) as HTMLElement;
    this.saveBtn = this.container.querySelector(
      ".link-popup-btn-save"
    ) as HTMLElement;

    // Append to document body (avoids interfering with editor DOM)
    document.body.appendChild(this.container);

    // Subscribe to store changes - only show() on open transition
    this.unsubscribe = useLinkPopupStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        // Only call show() when transitioning from closed to open
        if (!this.wasOpen) {
          this.show(state.href, state.anchorRect);
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });

    // Handle click outside
    document.addEventListener("mousedown", this.handleClickOutside);

    // Handle mouse leaving the popup
    this.container.addEventListener("mouseleave", this.handleMouseLeave);

    // Close popup on scroll (popup position becomes stale)
    this.editorView.dom.closest(".editor-container")?.addEventListener("scroll", this.handleScroll, true);
  }

  private getFocusableElements(): HTMLElement[] {
    return Array.from(
      this.container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null); // Exclude hidden elements
  }

  private setupKeyboardNavigation() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;

      if (e.key === "Tab") {
        const focusable = this.getFocusableElements();
        if (focusable.length === 0) return;

        const activeEl = document.activeElement as HTMLElement;
        const currentIndex = focusable.indexOf(activeEl);

        // Only handle Tab if focus is inside the popup
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
        // Handle Enter on focused buttons (input has its own handler)
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl && activeEl.tagName === "BUTTON" && this.container.contains(activeEl)) {
          e.preventDefault();
          activeEl.click();
        }
      } else if (e.key === "Escape") {
        // Handle ESC from any element inside the popup
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl && this.container.contains(activeEl)) {
          e.preventDefault();
          useLinkPopupStore.getState().closePopup();
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

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "link-popup";
    container.style.display = "none";

    // Input field
    const input = document.createElement("input");
    input.type = "text";
    input.className = "link-popup-input";
    input.placeholder = "URL...";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.addEventListener("input", this.handleInputChange);
    input.addEventListener("keydown", this.handleInputKeydown);

    // Icon buttons: open, copy, save, delete
    const openBtn = this.buildIconButton(icons.open, "Open link", this.handleOpen);
    openBtn.classList.add("link-popup-btn-open");
    const copyBtn = this.buildIconButton(icons.copy, "Copy URL", this.handleCopy);
    const saveBtn = this.buildIconButton(icons.save, "Save", this.handleSave);
    saveBtn.classList.add("link-popup-btn-save");
    const deleteBtn = this.buildIconButton(icons.delete, "Remove link", this.handleRemove);
    deleteBtn.classList.add("link-popup-btn-delete");

    container.appendChild(input);
    container.appendChild(openBtn);
    container.appendChild(copyBtn);
    container.appendChild(saveBtn);
    container.appendChild(deleteBtn);

    return container;
  }

  private buildIconButton(
    iconSvg: string,
    title: string,
    onClick: () => void
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "link-popup-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private show(href: string, anchorRect: AnchorRect) {
    const isBookmark = href.startsWith("#");

    this.input.value = href;
    this.container.style.display = "flex";
    this.container.style.position = "fixed";

    // Configure for bookmark vs regular link
    // Both allow editing - bookmarks can be manually edited too
    this.input.disabled = false;
    this.input.classList.remove("disabled");
    this.saveBtn.style.display = "";
    this.openBtn.title = isBookmark ? "Go to heading" : "Open link";

    // Set guard to prevent immediate close from same click event
    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    // Get boundaries: horizontal from ProseMirror, vertical from container
    const containerEl = this.editorView.dom.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    // Calculate position using utility
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: 320, height: 36 },
      bounds,
      gap: 6,
      preferAbove: true,
    });

    this.container.style.top = `${top}px`;
    this.container.style.left = `${left}px`;

    // Set up keyboard navigation
    this.setupKeyboardNavigation();

    // Focus input and select all
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.select();
    });
  }

  private hide() {
    this.container.style.display = "none";
    this.removeKeyboardNavigation();
  }

  private handleInputChange = () => {
    useLinkPopupStore.getState().setHref(this.input.value);
  };

  private handleInputKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      useLinkPopupStore.getState().closePopup();
      this.editorView.focus();
    }
  };

  private handleSave = () => {
    const state = useLinkPopupStore.getState();
    const { href, linkFrom, linkTo } = state;

    if (!href.trim()) {
      // Empty URL - remove the link
      this.handleRemove();
      return;
    }

    try {
      // Update the link mark
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const linkMark = editorState.schema.marks.link;
      if (!linkMark) return;

      const tr = editorState.tr;

      // Remove existing link mark and add new one with updated href
      tr.removeMark(linkFrom, linkTo, linkMark);
      tr.addMark(linkFrom, linkTo, linkMark.create({ href }));

      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      console.error("[LinkPopup] Save failed:", error);
      state.closePopup();
    }
  };

  private handleOpen = () => {
    const { href } = useLinkPopupStore.getState();
    if (!href) return;

    // Handle bookmark links - navigate to heading
    if (href.startsWith("#")) {
      const targetId = href.slice(1);
      const pos = findHeadingById(this.editorView.state.doc, targetId);
      if (pos !== null) {
        try {
          const $pos = this.editorView.state.doc.resolve(pos + 1);
          const selection = TextSelection.near($pos);
          this.editorView.dispatch(
            this.editorView.state.tr.setSelection(selection).scrollIntoView()
          );
          useLinkPopupStore.getState().closePopup();
          this.editorView.focus();
        } catch (error) {
          console.error("[LinkPopup] Navigation failed:", error);
        }
      }
      return;
    }

    // External link - open in browser
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
      openUrl(href).catch((error: unknown) => {
        console.error("Failed to open link:", error);
      });
    });
  };

  private handleCopy = async () => {
    const { href } = useLinkPopupStore.getState();
    if (href) {
      try {
        await navigator.clipboard.writeText(href);
        // Keep popup open for further actions - don't close
      } catch (err) {
        console.error("Failed to copy URL:", err);
      }
    }
  };

  private handleRemove = () => {
    const state = useLinkPopupStore.getState();
    const { linkFrom, linkTo } = state;

    try {
      // Remove the link mark, keeping the text
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const linkMark = editorState.schema.marks.link;
      if (!linkMark) return;

      const tr = editorState.tr.removeMark(linkFrom, linkTo, linkMark);

      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      console.error("[LinkPopup] Remove failed:", error);
      state.closePopup();
    }
  };

  private handleClickOutside = (e: MouseEvent) => {
    // Guard against race condition where same click opens and closes popup
    if (this.justOpened) return;

    const { isOpen } = useLinkPopupStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      // Just close the popup - don't auto-save to avoid issues
      // User can press Enter to save, or click buttons for actions
      useLinkPopupStore.getState().closePopup();
    }
  };

  private handleMouseLeave = (e: MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;

    // If moving back to a link in the editor, don't close
    if (relatedTarget?.closest("a")) {
      return;
    }

    // If input is focused (user is editing), don't close on mouse leave
    if (document.activeElement === this.input) {
      return;
    }

    // Close the popup
    useLinkPopupStore.getState().closePopup();
  };

  private handleScroll = () => {
    // Close popup on scroll - position becomes stale
    const { isOpen } = useLinkPopupStore.getState();
    if (isOpen) {
      useLinkPopupStore.getState().closePopup();
    }
  };

  destroy() {
    this.unsubscribe();
    this.removeKeyboardNavigation();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    this.editorView.dom.closest(".editor-container")?.removeEventListener("scroll", this.handleScroll, true);
    this.container.remove();
  }
}
