/**
 * Source Link Create Popup View
 *
 * Popup for creating new links in Source mode (CodeMirror 6).
 * Shows text + URL inputs when no selection, or just URL input when text is selected.
 *
 * Extends SourcePopupView for popup lifecycle; the shared LinkCreateFlow
 * controller (linkCreatePopup/linkCreateController.ts) owns the content
 * rebuild, input wiring, validation, and save/cancel flow. This view only
 * supplies the Source mode commit strategy: inserting `[text](url)` markdown,
 * using the repo's angle-bracket convention for destinations with whitespace.
 */

import type { EditorView } from "@codemirror/view";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { sourceActionError } from "@/utils/debug";
import { encodeMarkdownUrl, urlNeedsBrackets } from "@/utils/markdownUrl";
import { SourcePopupView, type PopupStoreBase } from "@/plugins/sourcePopup/SourcePopupView";
import {
  LinkCreateFlow,
  getLinkCreatePopupDimensions,
  type LinkCreateFlowState,
} from "@/plugins/linkCreatePopup/linkCreateController";

/** Link create popup store state (extends base with creation-specific fields) */
type LinkCreatePopupState = PopupStoreBase & LinkCreateFlowState;

/**
 * Source link create popup view - manages the floating popup UI for creating links.
 */
export class SourceLinkCreatePopupView extends SourcePopupView<LinkCreatePopupState> {
  private flow = new LinkCreateFlow(this.container, useLinkCreatePopupStore, {
    commitLink: (finalUrl, linkText, state) => this.commitLink(finalUrl, linkText, state),
    closePopup: () => this.closePopup(),
    focusEditor: () => this.focusEditor(),
    onError: (error) => sourceActionError("Save failed:", error),
  });

  constructor(view: EditorView) {
    super(view, useLinkCreatePopupStore);
  }

  protected buildContainer(): HTMLElement {
    // Bare shell — content is rebuilt on every show based on showTextInput
    const container = document.createElement("div");
    container.className = "link-create-popup";
    return container;
  }

  protected getPopupDimensions() {
    return getLinkCreatePopupDimensions(this.store.getState().showTextInput);
  }

  protected onShow(state: LinkCreatePopupState): void {
    this.flow.showContent(state);
  }

  protected onHide(): void {
    // No special cleanup needed
  }

  /** Source mode commit strategy: insert `[text](url)` markdown. */
  private commitLink(finalUrl: string, linkText: string | null, state: LinkCreateFlowState): boolean {
    const { rangeFrom, rangeTo, showTextInput } = state;

    // Escape markdown-sensitive characters so user text containing
    // brackets/backslashes doesn't break the [text](url) syntax.
    // Destinations with whitespace use the repo's angle-bracket convention
    // (encodeMarkdownUrl, CommonMark `<url>`); others escape parens/backslashes.
    const escapeText = (s: string) => s.replace(/[\\[\]]/g, "\\$&");
    const escapeHref = (s: string) =>
      s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const safeUrl = urlNeedsBrackets(finalUrl)
      ? encodeMarkdownUrl(finalUrl)
      : escapeHref(finalUrl);

    let markdown: string;
    if (showTextInput) {
      markdown = `[${escapeText(linkText ?? finalUrl)}](${safeUrl})`;
    } else {
      const existingText = this.editorView.state.doc.sliceString(rangeFrom, rangeTo);
      markdown = `[${escapeText(existingText)}](${safeUrl})`;
    }

    this.editorView.dispatch({
      changes: { from: rangeFrom, to: rangeTo, insert: markdown },
      selection: { anchor: rangeFrom + markdown.length },
    });

    return true;
  }
}
