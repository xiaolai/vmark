/**
 * Footnote Popup View
 *
 * Purpose: Manages the DOM for the footnote hover popup — renders footnote content
 * with inline editing, navigation to definition, and delete/renumber actions.
 *
 * Key decisions:
 *   - Extends WysiwygPopupView for lifecycle (mount, position, dismiss, Tab cycling)
 *   - Hover popup: never steals focus on show (getFirstFocusable returns null);
 *     the textarea is focused only when the store requests autoFocus
 *   - Re-shows while open when the hovered label changes or autoFocus turns on
 *     (shouldReshow hook)
 *   - Input is borderless with caret-only focus indicator (matching popup design system)
 *   - Save parses textarea content as markdown via parseMarkdown to preserve formatting
 *     (bold, italic, links, etc.) instead of creating plain text nodes
 *
 * @coordinates-with tiptap.ts — creates and destroys this view based on hover/click events
 * @coordinates-with stores/footnotePopupStore.ts — popup visibility and position state
 * @coordinates-with footnotePopupDom.ts — DOM construction and layout constants
 * @module plugins/footnotePopup/FootnotePopupView
 */

import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { footnotePopupWarn, footnotePopupError } from "@/utils/debug";
import type { AnchorRect } from "@/utils/popupPosition";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { isImeKeyEvent } from "@/utils/imeGuard";
import type { EditorView } from "@tiptap/pm/view";
import { scrollToPosition } from "./tiptapDomUtils";
import {
  buildDeleteFootnoteTransaction,
  collectVerifiedFootnoteDeletions,
  normalizeToSingleParagraph,
} from "./footnoteEditOps";
import { WysiwygPopupView, type PopupStoreBase } from "@/plugins/shared";
import {
  AUTOFOCUS_DELAY_MS,
  BLUR_CHECK_DELAY_MS,
  DEFAULT_POPUP_HEIGHT,
  DEFAULT_POPUP_WIDTH,
  POPUP_GAP_PX,
  TEXTAREA_MAX_HEIGHT,
  createFootnotePopupDom,
} from "./footnotePopupDom";

/** Footnote popup store state (extends base with footnote-specific fields) */
interface FootnotePopupState extends PopupStoreBase {
  content: string;
  label: string;
  definitionPos: number | null;
  referencePos: number | null;
  autoFocus: boolean;
  setContent: (content: string) => void;
}

export class FootnotePopupView extends WysiwygPopupView<FootnotePopupState> {
  private view: EditorView;
  private focusTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private blurTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(view: EditorView) {
    super(view, useFootnotePopupStore);
    this.view = view;

    // Handle mouse leave from popup (only when not editing)
    this.container.addEventListener("mouseleave", this.handlePopupMouseLeave);

    // The hover popup may already be open when the editor view is recreated
    this.syncFromStore();
  }

  // Lazy getter for the textarea (avoids constructor timing issues)
  private get textarea(): HTMLTextAreaElement {
    return this.container.querySelector(".footnote-popup-textarea") as HTMLTextAreaElement;
  }

  protected buildContainer(): HTMLElement {
    const dom = createFootnotePopupDom({
      onInputChange: () => this.handleInputChange(),
      onInputKeydown: (e) => this.handleInputKeydown(e),
      onTextareaClick: () => this.handleTextareaClick(),
      onTextareaBlur: () => this.handleTextareaBlur(),
      onGoto: () => this.handleGoto(),
      onSave: () => this.handleSave(),
      onDelete: () => this.handleDelete(),
    });
    return dom.container;
  }

  protected shouldReshow(prev: FootnotePopupState, state: FootnotePopupState): boolean {
    // Re-show on label change (hover moved to another footnote) or when
    // autoFocus turns on (click on the reference while hover popup is open)
    return state.label !== prev.label || (state.autoFocus && !prev.autoFocus);
  }

  /** Hover popup must not steal focus on show; autoFocus is handled in onShow. */
  protected getFirstFocusable(): HTMLElement | null {
    return null;
  }

  protected getPopupDimensions() {
    const rect = this.container.getBoundingClientRect();
    return {
      width: rect.width || DEFAULT_POPUP_WIDTH,
      height: rect.height || DEFAULT_POPUP_HEIGHT,
      gap: POPUP_GAP_PX,
      preferAbove: true,
    };
  }

  protected updatePosition(anchorRect: AnchorRect): void {
    super.updatePosition(anchorRect);
    this.autoResizeTextarea();
  }

  protected onShow(state: FootnotePopupState): void {
    this.textarea.value = state.content;

    const gotoBtn = this.container.querySelector(".footnote-popup-btn-goto") as HTMLElement | null;
    /* v8 ignore next -- @preserve else branch: goto button is always found in popup DOM */
    if (gotoBtn) gotoBtn.style.display = state.definitionPos !== null ? "flex" : "none";

    /* v8 ignore start -- @preserve else branch: autoFocus not exercised in tests */
    if (state.autoFocus) {
      this.container.classList.add("editing");
      this.clearFocusTimeout();
      this.focusTimeoutId = setTimeout(() => {
        // Only focus if popup is still open
        /* v8 ignore next -- @preserve else branch: popup closes before timeout fires in tests */
        if (this.store.getState().isOpen) {
          this.textarea.focus();
          this.textarea.select();
        }
      }, AUTOFOCUS_DELAY_MS);
    }
    /* v8 ignore stop */
  }

  protected onHide(): void {
    this.clearFocusTimeout();
    this.clearBlurTimeout();
  }

  private clearFocusTimeout(): void {
    if (this.focusTimeoutId) {
      clearTimeout(this.focusTimeoutId);
      this.focusTimeoutId = null;
    }
  }

  private clearBlurTimeout(): void {
    if (this.blurTimeoutId) {
      clearTimeout(this.blurTimeoutId);
      this.blurTimeoutId = null;
    }
  }

  private autoResizeTextarea(): void {
    this.textarea.style.height = "auto";
    this.textarea.style.height = Math.min(this.textarea.scrollHeight, TEXTAREA_MAX_HEIGHT) + "px";
  }

  private handleInputChange(): void {
    this.store.getState().setContent(this.textarea.value);
    this.autoResizeTextarea();
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.handleSave(); }
    else if (e.key === "Escape") {
      e.preventDefault();
      this.closeAndFocus();
    }
  }

  private handleTextareaClick(): void {
    this.container.classList.add("editing");
    this.textarea.focus();
  }

  private handleTextareaBlur(): void {
    this.clearBlurTimeout();
    this.blurTimeoutId = setTimeout(() => {
      /* v8 ignore next -- @preserve else branch: container still contains active element after blur in tests */
      if (!this.container.contains(document.activeElement)) this.container.classList.remove("editing");
    }, BLUR_CHECK_DELAY_MS);
  }

  /** Close popup and return focus to editor */
  private closeAndFocus(): void {
    this.closePopup();
    this.focusEditor();
  }

  private handleSave(): void {
    const state = this.store.getState();
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
        footnotePopupWarn("Definition node not found at position, may have moved");
        this.closeAndFocus();
        return;
      }

      if (node.attrs.label !== label) {
        footnotePopupWarn("Definition label mismatch, document may have changed");
        this.closeAndFocus();
        return;
      }

      // Parse markdown to PM nodes (preserving formatting), normalized to the
      // single paragraph footnote_definition's content spec accepts —
      // multi-block input would make replaceWith throw and lose the edit.
      const schema = editorState.schema;
      const paragraph = normalizeToSingleParagraph(schema, parseMarkdown(schema, content));

      // Replace the footnote definition's content (footnote_definition > paragraph)
      const contentStart = definitionPos + 1;
      const contentEnd = definitionPos + node.nodeSize - 1;

      const tr = editorState.tr.replaceWith(contentStart, contentEnd, paragraph);
      dispatch(tr);

      this.closeAndFocus();
    } catch (error) {
      // Keep the popup open — closing would silently discard the user's text.
      footnotePopupError("Save failed; keeping popup open to preserve the edit:", error);
    }
  }

  private handleGoto(): void {
    const { definitionPos } = this.store.getState();
    if (definitionPos !== null) {
      scrollToPosition(this.view, definitionPos);
      this.closeAndFocus();
    }
  }

  private handleDelete(): void {
    const { referencePos, definitionPos, label } = this.store.getState();

    if (referencePos === null) {
      this.closeAndFocus();
      return;
    }

    try {
      const { state: editorState, dispatch } = this.view;

      // Only delete nodes that are still verifiably THIS footnote (type and
      // label match) — stale positions must never delete the wrong footnote.
      const deletions =
        collectVerifiedFootnoteDeletions(editorState.doc, label, referencePos, definitionPos);
      const tr = buildDeleteFootnoteTransaction(editorState.tr, deletions);
      if (!tr) {
        footnotePopupWarn("No footnote nodes matching label found; nothing deleted");
        this.closeAndFocus();
        return;
      }

      dispatch(tr);
      this.closeAndFocus();
    } catch (error) {
      footnotePopupError("Delete failed:", error);
      this.closeAndFocus();
    }
  }

  private handlePopupMouseLeave = (): void => {
    if (!this.container.classList.contains("editing")) {
      this.closePopup();
    }
  };

  /** Reposition the popup if the anchor moved (called on editor updates). */
  update(): void {
    const state = this.store.getState();
    if (state.isOpen && state.anchorRect) {
      this.updatePosition(state.anchorRect);
    }
  }

  destroy(): void {
    this.clearFocusTimeout();
    this.clearBlurTimeout();
    this.container.removeEventListener("mouseleave", this.handlePopupMouseLeave);
    super.destroy();
  }
}
