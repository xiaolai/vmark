/**
 * Link Popup View
 *
 * DOM management for the link editing popup.
 * Shows when clicking on a link, allows editing/opening/copying/removing.
 *
 * Extends WysiwygPopupView for common popup lifecycle management.
 *
 * Key decisions:
 *   - The input — not the store — is the source of truth for the URL. Paste /
 *     IME / drop can land in the DOM without the synthetic `input` event that
 *     mirrors the value into the store, so save, open and copy all read (and
 *     trim) `input.value`.
 *   - The captured `[linkFrom, linkTo)` range is re-validated against the live
 *     document before every mutation (`linkRangeIsIntact`). A concurrent edit
 *     (MCP, external reload) can shift the range; applying it blindly would
 *     rewrite whatever now occupies those positions.
 *   - `shouldReshow` reopens the popup when it is retargeted at a different
 *     link range, so the input can never keep the previous link's URL.
 */

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import i18n from "@/i18n";
import { linkPopupError } from "@/utils/debug";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useTabStore, tabFilePath } from "@/stores/tabStore";
import { navigateToHeadingById } from "@/utils/headingSlug";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { classifyHref, openExternalLink, openFilepathLink } from "@/services/navigation/linkOpen";
import { WysiwygPopupView, type EditorViewLike, type PopupStoreBase } from "@/plugins/shared";
import { buildLinkPopupContainer } from "./linkPopupDom";
import { linkRangeIsIntact } from "./linkRange";

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
  /** The href the popup was opened on — the identity used to re-validate the
   *  captured range. Not the input value, which the user is free to change. */
  private openedHref = "";
  /** Pending focus frame, cancelled if the popup closes before it runs. */
  private focusFrame: number | null = null;

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
    // Markup only — listeners are attached in attachEventListeners().
    return buildLinkPopupContainer();
  }

  /** An open popup retargeted at a different link must re-run show(), or the
   *  input keeps the previous link's URL while the store already points at the
   *  new range — saving would then write URL A over link B. */
  protected shouldReshow(prev: LinkPopupState, next: LinkPopupState): boolean {
    return prev.linkFrom !== next.linkFrom || prev.linkTo !== next.linkTo;
  }

  /** The base class focuses this in a deferred frame; yield nothing once the
   *  popup is hidden, so a fast Escape / outside click cannot pull focus back
   *  out of the editor and into a hidden input. */
  protected getFirstFocusable(): HTMLElement | null {
    if (!this.isVisible() || !this.container.isConnected) return null;
    return this.input;
  }

  protected onShow(state: LinkPopupState): void {
    const isBookmark = state.href.startsWith("#");

    this.openedHref = state.href;
    this.input.value = state.href;
    const openLabel = isBookmark
      ? i18n.t("editor:popup.link.goToHeading")
      : i18n.t("editor:popup.link.openLink");
    this.openBtn.title = openLabel;
    this.openBtn.setAttribute("aria-label", openLabel);

    // Focus and select input. Guarded: a fast Escape / outside click can close
    // the popup before the frame runs, and focusing a hidden input would steal
    // focus back from the editor.
    this.cancelFocusFrame();
    this.focusFrame = requestAnimationFrame(() => {
      this.focusFrame = null;
      if (!this.isVisible() || !this.container.isConnected) return;
      this.input.focus();
      this.input.select();
    });
  }

  protected onHide(): void {
    this.cancelFocusFrame();
  }

  private cancelFocusFrame(): void {
    if (this.focusFrame !== null) {
      cancelAnimationFrame(this.focusFrame);
      this.focusFrame = null;
    }
  }

  /** The URL currently shown in the popup, trimmed. Surrounding whitespace
   *  would otherwise be stored verbatim and later misclassified as a filepath
   *  or fail URL parsing. */
  private currentHref(): string {
    return this.input.value.trim();
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

  /**
   * Rewrite the captured link range: drop the existing link mark and, when
   * `href` is non-null, add a link mark carrying it. Closes the popup and
   * returns focus to the editor on every path, including failures.
   */
  private mutateLinkRange(href: string | null, errorLabel: string): void {
    const { linkFrom, linkTo } = this.store.getState();
    const editorState = this.editorView.state;
    if (!editorState) return;

    const linkMark = editorState.schema.marks.link;
    if (!linkMark) return;

    try {
      if (!linkRangeIsIntact(editorState, linkFrom, linkTo, this.openedHref)) {
        // The document changed under the open popup (MCP edit, external
        // reload): the captured range no longer describes this link, so
        // applying it would rewrite unrelated text. Bail out instead.
        linkPopupError("Stale link range — skipping mutation:", { linkFrom, linkTo });
      } else {
        let tr = editorState.tr.removeMark(linkFrom, linkTo, linkMark);
        if (href !== null) {
          tr = tr.addMark(linkFrom, linkTo, linkMark.create({ href }));
        }
        this.editorView.dispatch(tr.setMeta("preventAutolink", true));
      }
    } catch (error) {
      linkPopupError(errorLabel, error);
    }

    this.closePopup();
    this.focusEditor();
  }

  private handleSave = () => {
    const href = this.currentHref();
    if (!href) {
      this.handleRemove();
      return;
    }
    this.mutateLinkRange(href, "Save failed:");
  };

  private handleRemove = () => {
    this.mutateLinkRange(null, "Remove failed:");
  };

  private handleOpen = () => {
    const href = this.currentHref();
    if (!href) return;

    const kind = classifyHref(href);

    if (kind === "fragment") {
      // Bookmark link — navigate to heading inside this document.
      if (navigateToHeadingById(this.editorView, href.slice(1))) {
        this.closePopup();
      }
      return;
    }

    if (kind === "external") {
      // Scheme-allowlisted opener (audit 20260612).
      openExternalLink(href).catch((error: unknown) => {
        linkPopupError("Failed to open link:", error);
      });
      return;
    }

    // Filepath — resolve relative to the active doc and open in a tab.
    // openFilepathLink is a pure leaf util; we read the source doc path
    // from the tab store here and pass it in.
    const activeTab = useTabStore
      .getState()
      .getActiveTab(getCurrentWebviewWindow().label);
    const sourcePath = activeTab ? tabFilePath(activeTab) : null;
    const { linkFrom, linkTo } = this.store.getState();
    openFilepathLink(href, sourcePath).then((opened) => {
      if (!opened) return;
      // The popup may have been closed or retargeted at another link while the
      // open was in flight — only close the popup this click belongs to.
      const state = this.store.getState();
      if (state.isOpen && state.linkFrom === linkFrom && state.linkTo === linkTo) {
        this.closePopup();
      }
    }).catch((error: unknown) => {
      linkPopupError("Failed to open file link:", error);
    });
  };

  private handleCopy = async () => {
    const href = this.currentHref();
    if (href) {
      try {
        await navigator.clipboard.writeText(href);
      } catch (err) {
        linkPopupError("Failed to copy URL:", err);
      }
    }
  };
}
