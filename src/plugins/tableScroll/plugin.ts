/**
 * Table Scroll Wrapper Extension
 *
 * Extends the Table node to wrap in a scrollable container,
 * allowing wide tables to scroll horizontally and extend
 * beyond the editor's content padding.
 *
 * Uses a NodeView (instead of just renderHTML) so that ProseMirror
 * has explicit dom/contentDOM references. Without a NodeView, the
 * wrapper div between the node's outer DOM and the tbody content
 * hole can break posAtCoords mapping (clicks don't place cursor)
 * and leaves no ignoreMutation to filter resize-handle mutations.
 */

import { Table } from "@tiptap/extension-table";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { withSourceLine } from "@/plugins/shared/sourceLineAttr";

/**
 * NodeView that wraps a table in a scrollable div.
 * Provides explicit dom/contentDOM for correct cursor placement
 * and ignoreMutation for column resize handles.
 */
class TableScrollNodeView implements NodeView {
  dom: HTMLDivElement;
  table: HTMLTableElement;
  contentDOM: HTMLTableSectionElement;
  node: PMNode;

  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = "table-scroll-wrapper";
    this.table = document.createElement("table");
    this.dom.appendChild(this.table);
    this.contentDOM = document.createElement("tbody");
    this.table.appendChild(this.contentDOM);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }

  /**
   * Ignore mutations on structural elements and column resize handles.
   *
   * Without the resize handle check, PM's MutationObserver sees the handle
   * div appended to a <th>, re-parses it as content (empty paragraph),
   * dispatches a reconciliation transaction WITH .scrollIntoView(), which
   * strips the handle. The resize manager then re-adds it after 200ms,
   * creating a loop where every cycle triggers scrollToSelection (#754).
   */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (
      mutation.type === "attributes" &&
      (mutation.target === this.dom || mutation.target === this.table)
    ) {
      return true;
    }
    if (!this.contentDOM.contains(mutation.target)) return true;

    // Column resize handles: ignore all mutations involving .table-resize-handle elements.
    // childList (add/remove) and attributes (.active class toggle) both need filtering.
    const target = mutation.target as HTMLElement;
    if (target.classList?.contains("table-resize-handle")) return true;

    if (mutation.type === "childList") {
      const nodes = [
        ...Array.from(mutation.addedNodes ?? []),
        ...Array.from(mutation.removedNodes ?? []),
      ];
      if (nodes.some((n) => (n as HTMLElement).classList?.contains("table-resize-handle"))) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Custom Table extension that renders with a scroll wrapper.
 * The wrapper enables:
 * - Horizontal scrolling for wide tables
 * - Full-width extension (breaking out of content padding)
 */
export const TableWithScrollWrapper = withSourceLine(
  Table.extend({
    // renderHTML is still used for serialization (copy/paste, export)
    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        { class: "table-scroll-wrapper" },
        ["table", HTMLAttributes, ["tbody", 0]],
      ];
    },

    addNodeView() {
      return ({ node }) => new TableScrollNodeView(node);
    },
  })
);
