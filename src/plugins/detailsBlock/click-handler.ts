/**
 * Details Block Click Handler
 *
 * Toggles open/close state when clicking on the summary.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";

const detailsClickPluginKey = new PluginKey("detailsClick");

/**
 * ProseMirror plugin to handle clicks on details summary
 */
export const detailsClickHandler = $prose(() => {
  return new Plugin({
    key: detailsClickPluginKey,
    props: {
      handleClick(view, pos, event) {
        const target = event.target as HTMLElement;

        // Check if click is on summary or its children
        const summary = target.closest("summary, .details-summary");
        if (!summary) return false;

        // Find the details block node
        const $pos = view.state.doc.resolve(pos);

        // Walk up to find detailsBlock
        for (let d = $pos.depth; d >= 0; d--) {
          const node = $pos.node(d);
          if (node.type.name === "detailsBlock") {
            const nodePos = $pos.before(d);

            // Toggle the open attribute
            const tr = view.state.tr.setNodeMarkup(nodePos, null, {
              ...node.attrs,
              open: !node.attrs.open,
            });

            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },
    },
  });
});
