/**
 * Source Mode Math Preview Plugin
 *
 * Purpose: Opens an editable math popup when the cursor is inside
 * math syntax ($...$, $$...$$, or ```latex```) in Source mode.
 * The popup provides a textarea for LaTeX editing with live KaTeX preview.
 *
 * Key decisions:
 *   - Opens the SourceMathPopupView (editable) rather than the old read-only preview
 *   - Debounces cursor checks to avoid popup flicker on rapid navigation
 *   - Distinguishes inline vs block math for appropriate positioning and save behavior
 *   - Click-outside the popup auto-saves; Escape cancels
 *
 * @coordinates-with sourceMathPopup/SourceMathPopupView.ts — the editable popup
 * @coordinates-with stores/sourceMathPopupStore.ts — popup state
 * @coordinates-with toolbarActions/sourceMathActions.ts — findInlineMathAtCursor, findBlockMathAtCursor
 * @module plugins/codemirror/sourceMathPreview
 */

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { findInlineMathAtCursor, findBlockMathAtCursor } from "@/plugins/toolbarActions/sourceMathActions";
import { useSourceMathPopupStore } from "@/stores/sourceMathPopupStore";
import { SourceMathPopupView } from "@/plugins/sourceMathPopup/SourceMathPopupView";

class SourceMathPreviewPlugin {
  private view: EditorView;
  private pendingUpdate = false;
  private popupView: SourceMathPopupView;

  constructor(view: EditorView) {
    this.view = view;
    // The popup declares its own state PORT and receives a store satisfying
    // it (ADR-015). This file already holds the store, so supplying it here
    // removes the popup plugin's own import without adding one anywhere.
    this.popupView = new SourceMathPopupView(view, useSourceMathPopupStore);
    this.scheduleCheck();
  }

  update(update: ViewUpdate) {
    // Don't recheck while popup is open (user is editing math content)
    if (useSourceMathPopupStore.getState().isOpen) return;

    if (update.selectionSet || update.docChanged) {
      this.scheduleCheck();
    }
  }

  private scheduleCheck() {
    if (this.pendingUpdate) return;
    this.pendingUpdate = true;
    requestAnimationFrame(() => {
      this.pendingUpdate = false;
      this.checkMathAtCursor();
    });
  }

  private checkMathAtCursor() {
    const { from, to } = this.view.state.selection.main;

    // Only show for collapsed selection (cursor, not range)
    if (from !== to) return;

    // Don't open if already open
    if (useSourceMathPopupStore.getState().isOpen) return;

    // Check for block math first ($$...$$ or ```latex...```)
    const blockMathRange = findBlockMathAtCursor(this.view, from);
    if (blockMathRange) {
      this.openPopup(blockMathRange.from, blockMathRange.to, blockMathRange.content, true);
      return;
    }

    // Then check for inline math ($...$)
    const inlineMathRange = findInlineMathAtCursor(this.view, from);
    if (inlineMathRange) {
      this.openPopup(inlineMathRange.from, inlineMathRange.to, inlineMathRange.content, false);
    }
  }

  private openPopup(mathFrom: number, mathTo: number, content: string, isBlock: boolean) {
    const fromCoords = this.view.coordsAtPos(mathFrom);
    const toCoords = this.view.coordsAtPos(mathTo);
    if (!fromCoords || !toCoords) return;

    let anchorRect: { top: number; left: number; bottom: number; right: number };

    if (isBlock) {
      const editorRect = this.view.dom.getBoundingClientRect();
      anchorRect = {
        top: Math.min(fromCoords.top, toCoords.top),
        left: editorRect.left,
        bottom: Math.max(fromCoords.bottom, toCoords.bottom),
        right: editorRect.right,
      };
    } else {
      anchorRect = {
        top: Math.min(fromCoords.top, toCoords.top),
        left: Math.min(fromCoords.left, toCoords.left),
        bottom: Math.max(fromCoords.bottom, toCoords.bottom),
        right: Math.max(toCoords.right, fromCoords.right),
      };
    }

    useSourceMathPopupStore.getState().openPopup(anchorRect, content, mathFrom, mathTo, isBlock);
  }

  destroy() {
    this.popupView.destroy();
  }
}

export function createSourceMathPreviewPlugin() {
  return [ViewPlugin.fromClass(SourceMathPreviewPlugin)];
}
