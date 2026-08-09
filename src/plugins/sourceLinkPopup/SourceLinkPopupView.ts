/**
 * Source Link Popup View
 *
 * Popup view for editing links in Source mode (CodeMirror 6).
 * Allows editing link URL, opening, copying, and removing links.
 */

import type { EditorView } from "@codemirror/view";
import i18n from "@/i18n";
import { SourcePopupView, type StoreApi } from "@/plugins/sourcePopup";
import type { LinkPopupState } from "@/plugins/shared/popupPorts";
import { buildPopupIconButton, popupIcons } from "@/utils/popupComponents";
import { copyLinkHref, openLink, removeLink, saveLinkChanges } from "./sourceLinkActions";

/** Build a source-link popup icon button on the canonical `.popup-icon-btn` surface (WI-DP4.1). */
function buildSourceLinkBtn(iconSvg: string, title: string, onClick: () => void): HTMLButtonElement {
  return buildPopupIconButton({ iconSvg, title, onClick });
}

/**
 * Source link popup view.
 * Extends the base SourcePopupView for common functionality.
 */
export class SourceLinkPopupView extends SourcePopupView<LinkPopupState> {
  // Use 'declare' to avoid ES2022 class field initialization overwriting values set in buildContainer()
  private declare hrefInput: HTMLInputElement;
  private declare openBtn: HTMLElement;
  private isBookmark = false;
  private reshowPrev: LinkPopupState | null = null;
  private unsubscribeReshow: () => void;

  constructor(view: EditorView, store: StoreApi<LinkPopupState>) {
    super(view, store);
    // shouldReshow port (WI-1 / D1, from WYSIWYG commit c89c1656): an open
    // popup retargeted at a different link range must refresh its fields, or
    // the input keeps the previous link's URL while the store already points
    // at the new range — saving would write URL A over link B. The base
    // subscription only runs show() on the closed→open transition, so this
    // second, subclass-local subscription covers open→open range changes.
    this.unsubscribeReshow = store.subscribe((state) => {
      const prev = this.reshowPrev;
      this.reshowPrev = state;
      if (!prev?.isOpen || !state.isOpen) return;
      if (prev.linkFrom === state.linkFrom && prev.linkTo === state.linkTo) return;
      this.refreshOnRetarget(state);
    });
  }

  override destroy(): void {
    this.unsubscribeReshow();
    super.destroy();
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
    this.hrefInput.placeholder = i18n.t("editor:popup.link.url.placeholder");
    this.hrefInput.autocapitalize = "off";
    this.hrefInput.autocomplete = "off";
    this.hrefInput.spellcheck = false;
    this.hrefInput.setAttribute("autocorrect", "off");
    this.hrefInput.addEventListener("keydown", this.handleInputKeydown.bind(this));
    this.hrefInput.addEventListener("input", this.handleHrefInput.bind(this));

    // Icon buttons: open, copy, delete
    this.openBtn = buildSourceLinkBtn(popupIcons.open, i18n.t("editor:popup.link.openLink"), this.handleOpen.bind(this));
    this.openBtn.classList.add("source-link-popup-btn-open");
    const copyBtn = buildSourceLinkBtn(popupIcons.copy, i18n.t("editor:popup.link.copyUrl"), this.handleCopy.bind(this));
    const deleteBtn = buildSourceLinkBtn(popupIcons.delete, i18n.t("editor:popup.link.remove"), this.handleRemove.bind(this));
    deleteBtn.classList.add("source-link-popup-btn-delete");

    hrefRow.appendChild(this.hrefInput);
    hrefRow.appendChild(this.openBtn);
    hrefRow.appendChild(copyBtn);
    hrefRow.appendChild(deleteBtn);

    container.appendChild(hrefRow);

    return container;
  }

  protected override getPopupDimensions() {
    return {
      width: 340,
      height: 40,
      gap: 6,
      preferAbove: true,
    };
  }

  /** Apply store state to the input and bookmark-mode chrome. Shared by the
   *  fresh-open path (onShow) and the retarget refresh (WI-1). */
  private applyState(state: LinkPopupState): void {
    this.isBookmark = state.href.startsWith("#");

    // Skip identical assignment: setting .value resets the caret, and the
    // remap path refreshes state under a user who may be mid-typing.
    if (this.hrefInput.value !== state.href) {
      this.hrefInput.value = state.href;
    }

    // Configure for bookmark vs regular link
    this.hrefInput.disabled = this.isBookmark;
    this.hrefInput.classList.toggle("disabled", this.isBookmark);
    const openLabel = this.isBookmark
      ? i18n.t("editor:popup.link.goToHeading")
      : i18n.t("editor:popup.link.openLink");
    this.openBtn.title = openLabel;
    this.openBtn.setAttribute("aria-label", openLabel);
  }

  private focusPrimaryControl(): void {
    requestAnimationFrame(() => {
      if (this.isBookmark) {
        this.openBtn.focus();
      } else {
        this.hrefInput.focus();
        this.hrefInput.select();
      }
    });
  }

  protected onShow(state: LinkPopupState): void {
    this.applyState(state);
    // Focus appropriate input (base class has already blurred the editor)
    this.focusPrimaryControl();
  }

  /** Open→open transition onto a different link range: refresh fields and
   *  position. A remap (same href, range merely moved by a concurrent edit)
   *  must not steal the caret or re-select while the user is typing; a
   *  genuine retarget refreshes focus like a fresh open. */
  private refreshOnRetarget(state: LinkPopupState): void {
    const hrefChanged = this.hrefInput.value !== state.href;
    this.applyState(state);
    if (state.anchorRect) {
      this.updatePosition(state.anchorRect);
    }
    if (hrefChanged) {
      this.focusPrimaryControl();
    }
  }

  protected onHide(): void {
    // Clear inputs
    this.hrefInput.value = "";
    this.hrefInput.disabled = false;
    this.hrefInput.classList.remove("disabled");
    this.isBookmark = false;
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    /* v8 ignore next -- @preserve reason: non-Enter keydown in link popup input not tested */
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    }
    // Escape is handled by base class
  }

  private handleHrefInput(): void {
    this.store.getState().setHref(this.hrefInput.value);
  }

  private handleSave(): void {
    // Read directly from the input rather than the store: paste / IME / drop
    // can land in the DOM without the synthetic `input` event we rely on to
    // mirror the value into the store, leaving the store stale at save time.
    const href = this.hrefInput.value;
    if (!href.trim()) {
      this.handleRemove();
      return;
    }

    // Sync the freshly read value back into the store so saveLinkChanges
    // (which reads `href` from the store) sees what the user actually typed.
    this.store.getState().setHref(href);
    saveLinkChanges(this.editorView, this.store);
    this.closePopup();
    this.focusEditor();
  }

  private handleOpen(): void {
    openLink(this.editorView, this.store);
  }

  private handleCopy(): void {
    copyLinkHref(this.store);
  }

  private handleRemove(): void {
    removeLink(this.editorView, this.store);
    this.closePopup();
    this.focusEditor();
  }
}
