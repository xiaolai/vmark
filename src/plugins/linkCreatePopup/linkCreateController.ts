/**
 * Link Create Flow Controller
 *
 * Purpose: Shared controller for the link-create popup flow, used by both
 * the WYSIWYG (LinkCreatePopupView) and Source mode (SourceLinkCreatePopupView)
 * variants. Owns everything mode-independent: content rebuild + input wiring
 * (via linkCreateDom), store synchronization, Enter/Escape handling, URL
 * validation, and the save/cancel lifecycle. The only mode-specific piece —
 * how the link is actually committed to the document — is injected as the
 * host's `commitLink` strategy.
 *
 * Key decisions:
 *   - commitLink returns whether it committed; the popup only closes on a
 *     real commit (mirrors the pre-extraction early-return behavior)
 *   - Errors thrown by commitLink go to host.onError and close the popup
 *     (link creation loses no user document content, unlike footnote save)
 *
 * @coordinates-with LinkCreatePopupView.ts — WYSIWYG consumer
 * @coordinates-with sourceLinkCreatePopup/SourceLinkCreatePopupView.ts — Source mode consumer
 * @coordinates-with linkCreateDom.ts — DOM construction
 * @coordinates-with operations.ts — URL normalization/validation (ADR-010)
 * @module plugins/linkCreatePopup/linkCreateController
 */

import { isImeKeyEvent } from "@/utils/imeGuard";
import type { PopupPositionConfig } from "@/plugins/shared/types";
import { normalizeHref, isValidHref } from "./operations";
import { buildLinkCreateContent } from "./linkCreateDom";

/** Mode-independent slice of the link-create popup store. */
export interface LinkCreateFlowState {
  text: string;
  url: string;
  showTextInput: boolean;
  rangeFrom: number;
  rangeTo: number;
  setText: (text: string) => void;
  setUrl: (url: string) => void;
}

/** Mode-specific strategy + lifecycle callbacks injected by each view. */
export interface LinkCreateFlowHost {
  /**
   * Commit the link to the document. Returns true when the edit was applied
   * (the popup then closes and the editor is refocused); false to keep the
   * popup open (e.g. missing schema mark). May throw — routed to onError.
   */
  commitLink: (finalUrl: string, linkText: string | null, state: LinkCreateFlowState) => boolean;
  closePopup: () => void;
  focusEditor: () => void;
  onError: (error: unknown) => void;
}

/** Both variants share the same popup dimensions. */
export function getLinkCreatePopupDimensions(showTextInput: boolean): PopupPositionConfig {
  return {
    width: 320,
    height: showTextInput ? 72 : 36,
    gap: 6,
    preferAbove: true,
  };
}

/**
 * Shared link-create popup flow: content rebuild, input wiring, validation,
 * save/cancel. Instantiated once per view; `showContent` is called on every
 * popup show because the text row depends on whether a selection existed.
 */
export class LinkCreateFlow {
  private textInput: HTMLInputElement | null = null;
  private urlInput: HTMLInputElement = document.createElement("input");

  constructor(
    private readonly container: HTMLElement,
    private readonly store: { getState: () => LinkCreateFlowState },
    private readonly host: LinkCreateFlowHost
  ) {}

  /** (Re)build the popup content for this show and focus the right input. */
  showContent(state: LinkCreateFlowState): void {
    const refs = buildLinkCreateContent(this.container, state.showTextInput, {
      onTextInput: () => this.handleTextInput(),
      onUrlInput: () => this.handleUrlInput(),
      onInputKeydown: (e) => this.handleInputKeydown(e),
      onSave: () => this.save(),
      onCancel: () => this.cancel(),
    });
    this.textInput = refs.textInput;
    this.urlInput = refs.urlInput;

    if (this.textInput) {
      this.textInput.value = state.text;
    }
    this.urlInput.value = "";

    requestAnimationFrame(() => {
      if (this.textInput && state.showTextInput) {
        this.textInput.focus();
        this.textInput.select();
      } else {
        this.urlInput.focus();
      }
    });
  }

  private handleTextInput(): void {
    /* v8 ignore next -- @preserve reason: handler is bound to this.textInput's 'input' event, so textInput is always non-null when this handler fires */
    if (this.textInput) {
      this.store.getState().setText(this.textInput.value);
    }
  }

  private handleUrlInput(): void {
    this.store.getState().setUrl(this.urlInput.value);
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      this.save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.cancel();
    }
  }

  save(): void {
    const state = this.store.getState();

    // ADR-010: shared URL normalization + validation via operations module.
    const finalUrl = normalizeHref(state.url);
    if (!isValidHref(finalUrl)) {
      // Focus URL input if empty/invalid
      this.urlInput.focus();
      return;
    }

    // Link text — falls back to the URL itself if the user left text blank.
    const linkText = state.showTextInput ? state.text.trim() || finalUrl : null;

    try {
      if (this.host.commitLink(finalUrl, linkText, state)) {
        this.host.closePopup();
        this.host.focusEditor();
      }
    } catch (error) {
      this.host.onError(error);
      this.host.closePopup();
    }
  }

  cancel(): void {
    this.host.closePopup();
    this.host.focusEditor();
  }
}
