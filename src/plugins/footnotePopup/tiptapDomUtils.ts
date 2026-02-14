/**
 * Footnote DOM Utilities
 *
 * Purpose: DOM traversal and scrolling helpers for finding footnote elements
 * (references and definitions) in the rendered editor and navigating between them.
 *
 * @coordinates-with tiptap.ts — uses these for hover detection and click navigation
 * @coordinates-with FootnotePopupView.ts — uses scrollToPosition for "go to definition" action
 * @module plugins/footnotePopup/tiptapDomUtils
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

const SCROLL_OFFSET_PX = 100;

export function scrollToPosition(view: EditorView, pos: number) {
  const coords = view.coordsAtPos(pos);
  const editorContent = document.querySelector(".editor-content");
  if (!coords || !editorContent) return;

  const editorRect = editorContent.getBoundingClientRect();
  const scrollTop = coords.top - editorRect.top + editorContent.scrollTop - SCROLL_OFFSET_PX;
  editorContent.scrollTo({ top: scrollTop, behavior: "smooth" });
}

export function findFootnoteDefinition(view: EditorView, label: string): { content: string; pos: number } | null {
  const { doc } = view.state;
  let result: { content: string; pos: number } | null = null;

  doc.descendants((node: PMNode, pos: number) => {
    if (result) return false;
    if (node.type.name === "footnote_definition" && String(node.attrs.label ?? "") === label) {
      result = { content: node.textContent.trim() || "Empty footnote", pos };
      return false;
    }
    return true;
  });

  return result;
}

export function findFootnoteReference(view: EditorView, label: string): number | null {
  const { doc } = view.state;
  let result: number | null = null;

  doc.descendants((node: PMNode, pos: number) => {
    if (result !== null) return false;
    if (node.type.name === "footnote_reference" && String(node.attrs.label ?? "") === label) {
      result = pos;
      return false;
    }
    return true;
  });

  return result;
}

const FOOTNOTE_REF_SELECTOR = 'sup[data-type="footnote_reference"]';
const FOOTNOTE_DEF_SELECTOR = 'dl[data-type="footnote_definition"]';

function getClosestElement(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!target) return null;

  let el: Element | null = null;
  if (target instanceof Element) {
    el = target;
  } else if (target instanceof Node && target.parentElement) {
    el = target.parentElement;
  }
  if (!el) return null;

  return el.closest<HTMLElement>(selector);
}

export function getFootnoteRefFromTarget(target: EventTarget | null): HTMLElement | null {
  return getClosestElement(target, FOOTNOTE_REF_SELECTOR);
}

export function getFootnoteDefFromTarget(target: EventTarget | null): HTMLElement | null {
  return getClosestElement(target, FOOTNOTE_DEF_SELECTOR);
}

