/**
 * Footnote Popup Tiptap Extension
 *
 * Purpose: Manages the footnote hover popup in WYSIWYG mode — shows footnote content
 * on hover/click of footnote references, with editing, deletion, and renumbering support.
 *
 * Pipeline: hover/click on [^n] → show popup with definition content → edit inline
 *         → delete → renumber remaining footnotes → cleanup orphaned definitions
 *
 * Key decisions:
 *   - Hover has a delay (150ms open, 100ms close) to avoid flickering on mouse movement
 *   - Hover state is per-EditorView (WeakMap-keyed) so multi-window / tear-off editors
 *     do not race on shared module timers.
 *   - Popup uses FootnotePopupView (DOM-based, not React) for performance
 *   - appendTransaction handles footnote deletion + renumbering in a single atomic step
 *   - appendTransaction skips during IME composition to avoid disrupting CJK input
 *   - Footnote references and definitions are bidirectionally linked for navigation
 *
 * @coordinates-with FootnotePopupView.ts — DOM construction and event handling for the popup
 * @coordinates-with tiptapCleanup.ts — renumbering and orphan cleanup transactions
 * @coordinates-with tiptapDomUtils.ts — DOM traversal for finding footnote elements
 * @coordinates-with tiptapNodes.ts — footnoteReference and footnoteDefinition node types
 * @coordinates-with stores/footnotePopupStore.ts — popup visibility and position state
 * @module plugins/footnotePopup/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction, type EditorState, NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode, NodeType, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { FootnotePopupView } from "./FootnotePopupView";
import { collectFootnoteNodes, createCleanupAndRenumberTransaction, createRenumberTransaction } from "./tiptapCleanup";
import { findFootnoteDefinition, findFootnoteReference, getFootnoteDefFromTarget, getFootnoteRefFromTarget, scrollToPosition } from "./tiptapDomUtils";
import "./footnote-popup.css";

export const footnotePopupPluginKey = new PluginKey("footnotePopup");

const HOVER_OPEN_DELAY_MS = 150;
const HOVER_CLOSE_DELAY_MS = 100;

type HoverState = {
  hoverTimeout: ReturnType<typeof setTimeout> | null;
  closeTimeout: ReturnType<typeof setTimeout> | null;
  currentRefElement: HTMLElement | null;
};

// Per-view hover state so multiple editor instances (e.g. main window and
// tear-off windows, or side-by-side editors) do not interfere with each
// other's hover timers. Previously these were module-scoped.
const hoverStates = new WeakMap<EditorView, HoverState>();

function getHoverState(view: EditorView): HoverState {
  let state = hoverStates.get(view);
  if (!state) {
    state = { hoverTimeout: null, closeTimeout: null, currentRefElement: null };
    hoverStates.set(view, state);
  }
  return state;
}

function clearHoverTimeout(state: HoverState) {
  if (state.hoverTimeout) {
    clearTimeout(state.hoverTimeout);
    state.hoverTimeout = null;
  }
}

function clearCloseTimeout(state: HoverState) {
  if (state.closeTimeout) {
    clearTimeout(state.closeTimeout);
    state.closeTimeout = null;
  }
}

function resetHoverState(view: EditorView) {
  const state = getHoverState(view);
  clearHoverTimeout(state);
  clearCloseTimeout(state);
  state.currentRefElement = null;
}

/**
 * Fast path: scan a transaction's inserted slices for a node of `refType`
 * or `defType`. Used to short-circuit when the cached doc state says there
 * are no footnotes — we only need to rewalk the whole doc if an insert
 * could have introduced one.
 */
function transactionsInsertFootnote(
  transactions: readonly Transaction[],
  refType: NodeType,
  defType: NodeType,
): boolean {
  for (const tr of transactions) {
    for (const step of tr.steps) {
      // ReplaceStep/ReplaceAroundStep expose `slice`; other step types don't.
      const slice = (step as { slice?: Slice }).slice;
      if (!slice) continue;
      let found = false;
      slice.content.descendants((node) => {
        if (node.type === refType || node.type === defType) {
          found = true;
          return false;
        }
        return true;
      });
      if (found) return true;
    }
  }
  return false;
}

/**
 * Short-circuit scan: stops on the first footnote reference or definition.
 * Cheaper than `collectFootnoteNodes` for the common "doc has no footnotes"
 * case, since it exits early rather than walking the entire document.
 */
function docContainsFootnotes(doc: PMNode): boolean {
  let hasFootnotes = false;
  doc.descendants((node) => {
    if (node.type.name === "footnote_reference" || node.type.name === "footnote_definition") {
      hasFootnotes = true;
      return false;
    }
    return true;
  });
  return hasFootnotes;
}

function handleMouseOver(view: EditorView, event: MouseEvent): boolean {
  const refElement = getFootnoteRefFromTarget(event.target);
  if (!refElement) return false;
  const state = getHoverState(view);
  if (state.currentRefElement === refElement) return false;

  clearCloseTimeout(state);
  clearHoverTimeout(state);

  state.hoverTimeout = setTimeout(() => {
    const label = refElement.getAttribute("data-label");
    if (!label) return;

    state.currentRefElement = refElement;

    const definition = findFootnoteDefinition(view, label);
    const content = definition?.content ?? "Footnote not found";
    const defPos = definition?.pos ?? null;
    const refPos = findFootnoteReference(view, label);

    const domRect = refElement.getBoundingClientRect();
    useFootnotePopupStore.getState().openPopup(
      label, content,
      { top: domRect.top, left: domRect.left, bottom: domRect.bottom, right: domRect.right },
      defPos, refPos
    );
  }, HOVER_OPEN_DELAY_MS);

  return false;
}

function handleMouseOut(view: EditorView, event: MouseEvent): boolean {
  const relatedTarget = event.relatedTarget as HTMLElement | null;

  if (relatedTarget?.closest(".footnote-popup")) return false;
  if (relatedTarget && getFootnoteRefFromTarget(relatedTarget)) return false;

  const state = getHoverState(view);
  clearHoverTimeout(state);
  state.currentRefElement = null;

  clearCloseTimeout(state);
  state.closeTimeout = setTimeout(() => {
    const popup = document.querySelector(".footnote-popup");
    if (!popup?.matches(":hover")) {
      useFootnotePopupStore.getState().closePopup();
    }
  }, HOVER_CLOSE_DELAY_MS);

  return false;
}

function handleMouseDown(_view: EditorView, event: MouseEvent): boolean {
  const refElement = getFootnoteRefFromTarget(event.target);
  return Boolean(refElement);
}

function handleKeyDown(_view: EditorView, event: KeyboardEvent): boolean {
  if (event.key === "Escape") {
    const { isOpen } = useFootnotePopupStore.getState();
    if (isOpen) {
      // Only close if not in editing mode (textarea focused)
      const popup = document.querySelector(".footnote-popup");
      if (popup && !popup.classList.contains("editing")) {
        useFootnotePopupStore.getState().closePopup();
        return true;
      }
    }
  }
  return false;
}

function handleClick(view: EditorView, _pos: number, event: MouseEvent): boolean {
  const refElement = getFootnoteRefFromTarget(event.target);
  if (refElement) {
    const label = refElement.getAttribute("data-label");
    if (label) {
      const definition = findFootnoteDefinition(view, label);
      if (definition?.pos !== undefined) {
        scrollToPosition(view, definition.pos);
        return true;
      }
    }
  }

  const defElement = getFootnoteDefFromTarget(event.target);
  if (defElement) {
    const label = defElement.getAttribute("data-label");
    if (label) {
      const refPos = findFootnoteReference(view, label);
      if (refPos !== null) {
        scrollToPosition(view, refPos);
        return true;
      }
    }
  }

  return false;
}

class FootnotePopupPluginView {
  private popupView: FootnotePopupView;
  private view: EditorView;
  private lastSelectedRefPos: number | null = null;

  constructor(view: EditorView) {
    this.view = view;
    this.popupView = new FootnotePopupView(view);
  }

  update() {
    this.popupView.update();
    this.checkSelectionForFootnote();
  }

  private checkSelectionForFootnote() {
    const { selection } = this.view.state;

    // Check if selection is a NodeSelection on a footnote_reference
    if (selection instanceof NodeSelection) {
      const node = selection.node;
      if (node.type.name === "footnote_reference") {
        const pos = selection.from;

        // Avoid re-opening for the same position
        if (this.lastSelectedRefPos === pos) return;
        this.lastSelectedRefPos = pos;

        /* v8 ignore next -- @preserve footnote_reference nodes always have a label attr */
        const label = String(node.attrs.label ?? "");
        const definition = findFootnoteDefinition(this.view, label);
        const content = definition?.content ?? "Footnote not found";
        const defPos = definition?.pos ?? null;

        // Get the DOM element for positioning
        const dom = this.view.nodeDOM(pos) as HTMLElement | null;
        if (dom) {
          const domRect = dom.getBoundingClientRect();
          useFootnotePopupStore.getState().openPopup(
            label, content,
            { top: domRect.top, left: domRect.left, bottom: domRect.bottom, right: domRect.right },
            defPos, pos
          );
        }
        return;
      }
    }

    // Selection moved away from footnote - close popup if it was opened via selection
    if (this.lastSelectedRefPos !== null) {
      this.lastSelectedRefPos = null;
      // Only close if popup is open and not in editing mode
      const popup = document.querySelector(".footnote-popup");
      if (popup && !popup.classList.contains("editing")) {
        useFootnotePopupStore.getState().closePopup();
      }
    }
  }

  destroy() {
    resetHoverState(this.view);
    this.popupView.destroy();
  }
}

export const footnotePopupExtension = Extension.create({
  name: "footnotePopup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: footnotePopupPluginKey,
        view(editorView) {
          const popup = new FootnotePopupPluginView(editorView);
          return {
            update: () => popup.update(),
            destroy: () => popup.destroy(),
          };
        },
        props: {
          handleClick,
          handleKeyDown,
          handleDOMEvents: {
            mousedown: handleMouseDown,
            mouseover: handleMouseOver,
            mouseout: handleMouseOut,
          },
        },
        appendTransaction: (() => {
          // Track whether cleanup was deferred during IME composition.
          // If a composition transaction deletes a footnote ref, the cleanup
          // can't run mid-composition (would disrupt CJK input), so we mark
          // it pending and run on the first non-composition doc change.
          let cleanupPending = false;
          // Cached result of the last full-doc "has footnotes" scan. null = not yet
          // determined (scan on first transaction). For large footnote-free docs,
          // this avoids walking the entire document on every keystroke.
          let hasFootnotesCache: boolean | null = null;

          return (transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) => {
          const refType = newState.schema.nodes.footnote_reference;
          const defType = newState.schema.nodes.footnote_definition;
          if (!refType || !defType) return null;

          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged && !cleanupPending) return null;

          // Skip during IME composition — dispatching transactions mid-composition
          // can cause ProseMirror to reconcile the DOM, disrupting active CJK input
          // (cf. Tiptap #6758 emoji extension, #7126 TableOfContents).
          const isComposition = transactions.some(
            (tr) => tr.getMeta("composition") || tr.getMeta("uiEvent") === "input"
          );
          if (isComposition) {
            // Mark pending if doc changed during composition — cleanup will
            // run on the next non-composition transaction.
            if (docChanged) cleanupPending = true;
            return null;
          }

          // If cleanup was deferred from a composition transaction, clear
          // the flag and run cleanup/renumber unconditionally based on the
          // current state — the old ref deletion is no longer visible in
          // oldState vs newState since both already reflect the change.
          const wasDeferred = cleanupPending;
          cleanupPending = false;

          // Fast path: if we already know the doc has no footnotes, inspect only
          // the transaction's inserted slices. If none contain footnote nodes,
          // skip entirely — no need to rewalk the whole doc.
          if (hasFootnotesCache === false) {
            if (!transactionsInsertFootnote(transactions, refType, defType)) return null;
            // A footnote slice was inserted — fall through to full scan and refresh cache.
          }

          // Fast check: if new doc has no footnote refs AND no definitions, skip full scan
          const hasFootnotes = docContainsFootnotes(newState.doc);
          hasFootnotesCache = hasFootnotes;
          if (!hasFootnotes) return null;

          const newCollected = collectFootnoteNodes(newState.doc);
          const newRefLabels = newCollected.refLabels;

          if (!wasDeferred) {
            // Normal path: check if any ref was deleted in this transaction
            const oldCollected = collectFootnoteNodes(oldState.doc);
            const oldRefLabels = oldCollected.refLabels;

            let refDeleted = false;
            for (const label of oldRefLabels) {
              if (!newRefLabels.has(label)) {
                refDeleted = true;
                break;
              }
            }
            if (!refDeleted) return null;
          }
          // Deferred path: skip refDeleted check — cleanup needed regardless

          const defs = newCollected.defs;
          const orphanedDefs = defs.filter((d) => !newRefLabels.has(d.label));

          if (orphanedDefs.length === 0 && newRefLabels.size === 0) {
            if (defs.length > 0) {
              let tr = newState.tr;
              const sortedDefs = [...defs].sort((a, b) => b.pos - a.pos);
              for (const def of sortedDefs) {
                tr = tr.delete(def.pos, def.pos + def.size);
              }
              return tr;
            }
            return null;
          }

          if (orphanedDefs.length === 0) {
            return createRenumberTransaction(newState, refType, defType, newCollected);
          }

          return createCleanupAndRenumberTransaction(newState, newRefLabels, refType, defType, newCollected);
          };
        })(),
      }),
    ];
  },
});
