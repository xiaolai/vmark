/**
 * Table of Contents — NodeView
 *
 * Purpose: Renders a live, clickable table of contents in the WYSIWYG editor.
 * Extracts headings from the document on every transaction and updates the
 * rendered list. Click events scroll to the target heading.
 *
 * Key decisions:
 *   - Dirty-check includes heading positions so stale anchors are re-rendered
 *     when headings move without changing text/level
 *   - Click handler wraps Selection.near/domAtPos in try/catch — positions
 *     can be stale between the render and click event
 *   - update() guards node.type.name to reject non-toc node replacements
 *
 * @coordinates-with tiptap.ts — registers this NodeView for the `toc` node
 * @coordinates-with headingSlug.ts — extracts headings with stable IDs
 * @module plugins/tableOfContents/TocNodeView
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import { extractHeadingsWithIds, type HeadingWithId } from "@/utils/headingSlug";
import { tocLog, tocWarn } from "@/utils/debug";

class TocNodeViewImpl implements NodeView {
  dom: HTMLElement;
  private list: HTMLUListElement;
  private view: EditorView;
  private lastHeadingsKey = "";

  constructor(_node: PMNode, view: EditorView, _getPos: () => number) {
    this.view = view;

    // Build DOM structure
    this.dom = document.createElement("nav");
    this.dom.className = "toc-block";
    this.dom.setAttribute("data-type", "toc");
    this.dom.setAttribute("aria-label", "Table of Contents");
    this.dom.contentEditable = "false";

    this.list = document.createElement("ul");
    this.list.className = "toc-list";
    this.dom.appendChild(this.list);

    // Click handler for heading navigation
    this.list.addEventListener("click", this.handleClick);

    // Initial render
    this.renderHeadings(view.state.doc);
  }

  /** Called on every transaction. Re-render only when headings change. */
  update(node: PMNode): boolean {
    if (node.type.name !== "toc") return false;
    const doc = this.view.state.doc;
    this.renderHeadings(doc);
    return true;
  }

  destroy(): void {
    this.list.removeEventListener("click", this.handleClick);
  }

  /** Stop click events on TOC links (we handle navigation), let other events through for node selection/drag. */
  stopEvent(event: Event): boolean {
    if (event.type === "mousedown" || event.type === "click") {
      const target = event.target as HTMLElement;
      if (target.closest("a[data-toc-pos]")) return true;
    }
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  private renderHeadings(doc: PMNode): void {
    const headings = extractHeadingsWithIds(doc);
    // Include pos so stale anchor positions trigger re-render when headings move
    const key = headings.map((h) => `${h.level}:${h.pos}:${h.id}:${h.text}`).join("\n");

    // Skip re-render if headings haven't changed
    if (key === this.lastHeadingsKey) return;
    this.lastHeadingsKey = key;

    // Clear existing content
    while (this.list.firstChild) {
      this.list.removeChild(this.list.firstChild);
    }

    if (headings.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "toc-empty";
      emptyLi.textContent = "No headings";
      this.list.appendChild(emptyLi);
      return;
    }

    const minLevel = Math.min(...headings.map((h) => h.level));

    for (const heading of headings) {
      this.list.appendChild(this.createItem(heading, minLevel));
    }
  }

  private createItem(heading: HeadingWithId, minLevel: number): HTMLLIElement {
    const indent = heading.level - minLevel;
    const li = document.createElement("li");
    li.className = `toc-item toc-level-${heading.level}`;
    if (indent > 0) {
      li.style.paddingLeft = `${indent * 1.2}em`;
    }

    const anchor = document.createElement("a");
    anchor.href = `#${heading.id}`;
    anchor.dataset.tocPos = String(heading.pos);
    anchor.textContent = heading.text;

    li.appendChild(anchor);
    return li;
  }

  private handleClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a[data-toc-pos]") as HTMLAnchorElement | null;
    if (!anchor) return;

    e.preventDefault();
    e.stopPropagation();

    const pos = parseInt(anchor.dataset.tocPos ?? "", 10);
    if (isNaN(pos)) return;

    const { doc, tr } = this.view.state;
    if (pos < 0 || pos >= doc.content.size) {
      tocLog("TOC click: pos out of range", pos, doc.content.size);
      return;
    }

    // Scroll the heading into view by setting the selection there.
    // Positions can be stale between render and click — guard with try/catch.
    try {
      this.view.dispatch(tr.setSelection(
        Selection.near(doc.resolve(pos))
      ));
      this.view.focus();
    } catch (err) {
      tocWarn("TOC navigation failed (stale position?)", err);
      return;
    }

    // Scroll the heading DOM element into view
    try {
      const domNode = this.view.domAtPos(pos + 1);
      if (domNode?.node) {
        const el = domNode.node instanceof HTMLElement
          ? domNode.node
          : domNode.node.parentElement;
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch {
      // domAtPos can throw for stale positions — selection already moved, scroll is best-effort
    }
  };
}

export function createTocNodeView(
  node: PMNode,
  view: EditorView,
  getPos: () => number,
): NodeView {
  return new TocNodeViewImpl(node, view, getPos);
}
