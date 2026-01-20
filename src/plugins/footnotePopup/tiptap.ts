import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction, NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { FootnotePopupView } from "./FootnotePopupView";
import { createCleanupAndRenumberTransaction, createRenumberTransaction, getDefinitionInfo, getReferenceLabels } from "./tiptapCleanup";
import { findFootnoteDefinition, findFootnoteReference, getFootnoteDefFromTarget, getFootnoteRefFromTarget, scrollToPosition } from "./tiptapDomUtils";

export const footnotePopupPluginKey = new PluginKey("footnotePopup");

const HOVER_OPEN_DELAY_MS = 150;
const HOVER_CLOSE_DELAY_MS = 100;

let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
let closeTimeout: ReturnType<typeof setTimeout> | null = null;
let currentRefElement: HTMLElement | null = null;

function clearHoverTimeout() {
  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
    hoverTimeout = null;
  }
}

function clearCloseTimeout() {
  if (closeTimeout) {
    clearTimeout(closeTimeout);
    closeTimeout = null;
  }
}

function resetHoverState() {
  clearHoverTimeout();
  clearCloseTimeout();
  currentRefElement = null;
}

function handleMouseOver(view: EditorView, event: MouseEvent): boolean {
  const refElement = getFootnoteRefFromTarget(event.target);
  if (!refElement) return false;
  if (currentRefElement === refElement) return false;

  clearCloseTimeout();
  clearHoverTimeout();

  hoverTimeout = setTimeout(() => {
    const label = refElement.getAttribute("data-label");
    if (!label) return;

    currentRefElement = refElement;

    const definition = findFootnoteDefinition(view, label);
    const content = definition?.content ?? "Footnote not found";
    const defPos = definition?.pos ?? null;
    const refPos = findFootnoteReference(view, label);

    useFootnotePopupStore.getState().openPopup(label, content, refElement.getBoundingClientRect(), defPos, refPos);
  }, HOVER_OPEN_DELAY_MS);

  return false;
}

function handleMouseOut(_view: EditorView, event: MouseEvent): boolean {
  const relatedTarget = event.relatedTarget as HTMLElement | null;

  if (relatedTarget?.closest(".footnote-popup")) return false;
  if (relatedTarget && getFootnoteRefFromTarget(relatedTarget)) return false;

  clearHoverTimeout();
  currentRefElement = null;

  clearCloseTimeout();
  closeTimeout = setTimeout(() => {
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
    this.popupView = new FootnotePopupView(view as unknown as ConstructorParameters<typeof FootnotePopupView>[0]);
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

        const label = String(node.attrs.label ?? "");
        const definition = findFootnoteDefinition(this.view, label);
        const content = definition?.content ?? "Footnote not found";
        const defPos = definition?.pos ?? null;

        // Get the DOM element for positioning
        const dom = this.view.nodeDOM(pos) as HTMLElement | null;
        if (dom) {
          const rect = dom.getBoundingClientRect();
          useFootnotePopupStore.getState().openPopup(label, content, rect, defPos, pos);
        }
        return;
      }
    }

    // Selection is not on a footnote - reset tracking
    this.lastSelectedRefPos = null;
  }

  destroy() {
    resetHoverState();
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
          const popup = new FootnotePopupPluginView(editorView as unknown as EditorView);
          return {
            update: () => popup.update(),
            destroy: () => popup.destroy(),
          };
        },
        props: {
          handleClick,
          handleDOMEvents: {
            mousedown: handleMouseDown,
            mouseover: handleMouseOver,
            mouseout: handleMouseOut,
          },
        },
        appendTransaction(transactions: readonly Transaction[], oldState, newState) {
          const refType = newState.schema.nodes.footnote_reference;
          const defType = newState.schema.nodes.footnote_definition;
          if (!refType || !defType) return null;

          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          const oldRefLabels = getReferenceLabels(oldState.doc);
          const newRefLabels = getReferenceLabels(newState.doc);

          let refDeleted = false;
          for (const label of oldRefLabels) {
            if (!newRefLabels.has(label)) {
              refDeleted = true;
              break;
            }
          }
          if (!refDeleted) return null;

          const defs = getDefinitionInfo(newState.doc);
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
            return createRenumberTransaction(newState, refType, defType);
          }

          return createCleanupAndRenumberTransaction(newState, newRefLabels, refType, defType);
        },
      }),
    ];
  },
});
