/**
 * Link Create Popup View
 *
 * Popup for creating new links in WYSIWYG mode.
 * Shows text + URL inputs when no selection, or just URL input when text is selected.
 *
 * Extends WysiwygPopupView for popup lifecycle; the shared LinkCreateFlow
 * controller (linkCreateController.ts) owns the content rebuild, input
 * wiring, validation, and save/cancel flow. This view only supplies the
 * WYSIWYG commit strategy: applying a link mark via a ProseMirror transaction.
 */

import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { linkPopupError } from "@/utils/debug";
import { WysiwygPopupView, type EditorViewLike, type PopupStoreBase } from "@/plugins/shared";
import {
  LinkCreateFlow,
  getLinkCreatePopupDimensions,
  type LinkCreateFlowState,
} from "./linkCreateController";

/** Link create popup store state (extends base with creation-specific fields) */
type LinkCreatePopupState = PopupStoreBase & LinkCreateFlowState;

/**
 * Link create popup view - manages the floating popup UI for creating links.
 */
export class LinkCreatePopupView extends WysiwygPopupView<LinkCreatePopupState> {
  private flow = new LinkCreateFlow(this.container, useLinkCreatePopupStore, {
    commitLink: (finalUrl, linkText, state) => this.commitLink(finalUrl, linkText, state),
    closePopup: () => this.closePopup(),
    focusEditor: () => this.focusEditor(),
    onError: (error) => linkPopupError("Save failed:", error),
  });

  constructor(view: EditorViewLike) {
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

  /** WYSIWYG commit strategy: create/apply a link mark via a PM transaction. */
  private commitLink(finalUrl: string, linkText: string | null, state: LinkCreateFlowState): boolean {
    const { state: editorState, dispatch } = this.editorView;
    if (!editorState) return false;

    const linkMark = editorState.schema.marks.link;
    if (!linkMark) return false;

    const tr = editorState.tr;

    if (state.showTextInput) {
      // Create new text with link mark
      const textNode = editorState.schema.text(linkText!, [linkMark.create({ href: finalUrl })]);
      tr.replaceWith(state.rangeFrom, state.rangeTo, textNode);
    } else {
      // Apply link mark to existing selection/text
      tr.addMark(state.rangeFrom, state.rangeTo, linkMark.create({ href: finalUrl }));
    }

    dispatch(tr);
    return true;
  }
}
