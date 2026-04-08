/**
 * Link Popup View
 *
 * DOM management for the link editing popup.
 * Shows when clicking on a link, allows editing/opening/copying/removing.
 *
 * Extends WysiwygPopupView for common popup lifecycle management.
 */

import { TextSelection } from "@tiptap/pm/state";
import i18n from "@/i18n";
import { linkPopupError } from "@/utils/debug";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { findHeadingById } from "@/utils/headingSlug";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { popupIcons } from "@/utils/popupComponents";
import { WysiwygPopupView, type EditorViewLike, type PopupStoreBase } from "@/plugins/shared";

/** Link popup store state (extends base with link-specific fields) */
interface LinkPopupState extends PopupStoreBase {
  href: string;
  linkFrom: number;
  linkTo: number;
  setHref: (href: string) => void;
}

/**
 * Link popup view - manages the floating popup UI.
 */
export class LinkPopupView extends WysiwygPopupView<LinkPopupState> {
  constructor(view: EditorViewLike) {
    super(view, useLinkPopupStore);
    // Attach event listeners after super() (arrow functions are now initialized)
    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    this.input.addEventListener("input", this.handleInputChange);
    this.input.addEventListener("keydown", this.handleInputKeydown);
    this.openBtn.addEventListener("click", this.handleOpen);
    this.copyBtn.addEventListener("click", this.handleCopy);
    this.saveBtn.addEventListener("click", this.handleSave);
    this.deleteBtn.addEventListener("click", this.handleRemove);
  }

  protected getPopupDimensions() {
    return { width: 320, height: 36, gap: 6, preferAbove: true };
  }

  // Lazy getters for DOM elements (avoids constructor timing issues)
  private get input(): HTMLInputElement {
    return this.container.querySelector(".link-popup-input") as HTMLInputElement;
  }

  private get openBtn(): HTMLElement {
    return this.container.querySelector(".link-popup-btn-open") as HTMLElement;
  }

  private get copyBtn(): HTMLElement {
    return this.container.querySelector(".link-popup-btn-copy") as HTMLElement;
  }

  private get saveBtn(): HTMLElement {
    return this.container.querySelector(".link-popup-btn-save") as HTMLElement;
  }

  private get deleteBtn(): HTMLElement {
    return this.container.querySelector(".link-popup-btn-delete") as HTMLElement;
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "link-popup";

    // Input field (event listeners attached in attachEventListeners)
    const input = document.createElement("input");
    input.type = "text";
    input.className = "link-popup-input";
    input.placeholder = i18n.t("editor:popup.link.url.placeholder");
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");

    // Icon buttons (event listeners attached in attachEventListeners)
    const openBtn = this.buildButton(popupIcons.open, i18n.t("editor:popup.link.openLink"), "link-popup-btn-open");
    const copyBtn = this.buildButton(popupIcons.copy, i18n.t("editor:popup.link.copyUrl"), "link-popup-btn-copy");
    const saveBtn = this.buildButton(popupIcons.save, i18n.t("editor:popup.link.save"), "link-popup-btn-save");
    const deleteBtn = this.buildButton(popupIcons.delete, i18n.t("editor:popup.link.remove"), "link-popup-btn-delete");

    container.appendChild(input);
    container.appendChild(openBtn);
    container.appendChild(copyBtn);
    container.appendChild(saveBtn);
    container.appendChild(deleteBtn);

    return container;
  }

  /** Build a button without click handler (attached later in constructor) */
  private buildButton(iconSvg: string, title: string, className: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `link-popup-btn ${className}`;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = iconSvg;
    return btn;
  }

  protected onShow(state: LinkPopupState): void {
    const isBookmark = state.href.startsWith("#");

    this.input.value = state.href;
    this.input.disabled = false;
    this.input.classList.remove("disabled");
    this.saveBtn.style.display = "";
    this.openBtn.title = isBookmark ? i18n.t("editor:popup.link.goToHeading") : i18n.t("editor:popup.link.openLink");

    // Focus and select input
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.select();
    });
  }

  protected onHide(): void {
    // No special cleanup needed
  }

  private handleInputChange = () => {
    this.store.getState().setHref(this.input.value);
  };

  private handleInputKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    /* v8 ignore start -- @preserve non-Enter/Escape keys are not handled */
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.closePopup();
      this.focusEditor();
    }
    /* v8 ignore stop */
  };

  private handleSave = () => {
    const state = this.store.getState();
    const { href, linkFrom, linkTo } = state;

    if (!href.trim()) {
      this.handleRemove();
      return;
    }

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const linkMark = editorState.schema.marks.link;
      if (!linkMark) return;

      const tr = editorState.tr;
      tr.removeMark(linkFrom, linkTo, linkMark);
      tr.addMark(linkFrom, linkTo, linkMark.create({ href }));

      dispatch(tr);
      this.closePopup();
      this.focusEditor();
    } catch (error) {
      linkPopupError("Save failed:", error);
      this.closePopup();
    }
  };

  private handleOpen = () => {
    const { href } = this.store.getState();
    if (!href) return;

    // Handle bookmark links - navigate to heading
    if (href.startsWith("#")) {
      const targetId = href.slice(1);
      const pos = findHeadingById(this.editorView.state.doc, targetId);
      if (pos !== null) {
        try {
          const $pos = this.editorView.state.doc.resolve(pos + 1);
          const selection = TextSelection.near($pos);
          const tr = this.editorView.state.tr.setSelection(selection).scrollIntoView();
          this.editorView.dispatch(tr.setMeta("addToHistory", false));
          this.closePopup();
          this.focusEditor();
        } catch (error) {
          linkPopupError("Navigation failed:", error);
        }
      }
      return;
    }

    // External link - open in browser
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
      /* v8 ignore next -- @preserve openUrl failure is a Tauri runtime error; not testable in jsdom */
      openUrl(href).catch((error: unknown) => {
        linkPopupError("Failed to open link:", error);
      });
    }).catch(linkPopupError);
  };

  private handleCopy = async () => {
    const { href } = this.store.getState();
    if (href) {
      try {
        await navigator.clipboard.writeText(href);
      } catch (err) {
        linkPopupError("Failed to copy URL:", err);
      }
    }
  };

  private handleRemove = () => {
    const state = this.store.getState();
    const { linkFrom, linkTo } = state;

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const linkMark = editorState.schema.marks.link;
      if (!linkMark) return;

      const tr = editorState.tr
        .removeMark(linkFrom, linkTo, linkMark)
        .setMeta("preventAutolink", true);

      dispatch(tr);
      this.closePopup();
      this.focusEditor();
    } catch (error) {
      linkPopupError("Remove failed:", error);
      this.closePopup();
    }
  };
}
