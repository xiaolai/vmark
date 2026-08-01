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

import { linkPopupError } from "@/utils/debug";
import { WysiwygPopupView, type EditorViewLike, type PopupStoreBase } from "@/plugins/shared";
import type { StoreApi } from "@/plugins/shared/types";
import {
  LinkCreateFlow,
  getLinkCreatePopupDimensions,
  type LinkCreateFlowState,
} from "./linkCreateController";

/** Link create popup store state (extends base with creation-specific fields) */
/**
 * The popup state this view needs — the plugin's PORT, declared here so the
 * plugin never names the app's store (ADR-015).
 */
export type LinkCreatePopupState = PopupStoreBase & LinkCreateFlowState;

/**
 * Link create popup view - manages the floating popup UI for creating links.
 */
export class LinkCreatePopupView extends WysiwygPopupView<LinkCreatePopupState> {
  // Built in the CONSTRUCTOR, not as a field initializer: it needs the store
  // that arrives as a constructor parameter, and a field initializer cannot
  // see one.
  private flow: LinkCreateFlow;

  constructor(view: EditorViewLike, store: StoreApi<LinkCreatePopupState>) {
    super(view, store);
    this.flow = new LinkCreateFlow(this.container, store, {
      commitLink: (finalUrl, linkText, state) => this.commitLink(finalUrl, linkText, state),
      closePopup: () => this.closePopup(),
      focusEditor: () => this.focusEditor(),
      onError: (error) => linkPopupError("Save failed:", error),
    });
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
