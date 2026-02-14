/**
 * Details Block Tiptap Node
 *
 * Purpose: Defines the detailsBlock and detailsSummary node types for collapsible
 * `<details>/<summary>` blocks in WYSIWYG mode, with input rules and click-to-toggle.
 *
 * Key decisions:
 *   - Two node types: detailsBlock (wrapper) and detailsSummary (clickable header)
 *   - Input rule triggers on `<details>` or `:::details` at line start
 *   - Click on summary toggles the open/closed state via node attribute
 *   - Default summary text is "Click to expand" for new blocks
 *
 * @coordinates-with codemirror/sourceDetailsDecoration.ts — Source mode visual markers
 * @coordinates-with shared/sourceLineAttr.ts — source line tracking for cursor sync
 * @module plugins/detailsBlock/tiptap
 */

import { InputRule, Node } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { sourceLineAttr } from "../shared/sourceLineAttr";

const detailsClickPluginKey = new PluginKey("detailsClick");
const DETAILS_INPUT_PATTERN = /^(?:<details>|:::details)\s*$/i;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    detailsBlock: {
      insertDetailsBlock: () => ReturnType;
    };
  }
}

function createDetailsBlockNode(state: EditorState, open: boolean) {
  const detailsType = state.schema.nodes.detailsBlock;
  const summaryType = state.schema.nodes.detailsSummary;
  const paragraphType = state.schema.nodes.paragraph;
  if (!detailsType || !summaryType || !paragraphType) return null;

  const summaryNode = summaryType.create(null, state.schema.text("Click to expand"));
  const contentNode = paragraphType.create();
  return detailsType.create({ open }, [summaryNode, contentNode]);
}

export const detailsSummaryExtension = Node.create({
  name: "detailsSummary",
  content: "inline*",
  defining: true,
  selectable: false,

  addAttributes() {
    return {
      ...sourceLineAttr,
    };
  },

  parseHTML() {
    return [{ tag: "summary" }];
  },

  renderHTML() {
    return ["summary", { class: "details-summary" }, 0];
  },
});

export const detailsBlockExtension = Node.create({
  name: "detailsBlock",
  group: "block",
  content: "detailsSummary block+",
  defining: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      open: {
        default: false,
        parseHTML: (element) => (element as HTMLElement).hasAttribute("open"),
        renderHTML: (attributes) => (attributes.open ? { open: "open" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", { ...HTMLAttributes, class: "details-block" }, 0];
  },

  addCommands() {
    return {
      insertDetailsBlock:
        () =>
        ({ state, dispatch }) => {
          const detailsNode = createDetailsBlockNode(state, true);
          if (!detailsNode) return false;

          const { $from } = state.selection;
          const insertPos = $from.end($from.depth) + 1;

          if (!dispatch) return true;

          const tr = state.tr.insert(insertPos, detailsNode);
          const summarySize = detailsNode.firstChild?.nodeSize ?? 0;
          tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1 + summarySize + 1)));
          dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: DETAILS_INPUT_PATTERN,
        handler: ({ state, range, commands }) => {
          const detailsNode = createDetailsBlockNode(state, true);
          if (!detailsNode) return null;

          const $start = state.doc.resolve(range.from);
          const paragraphStart = $start.before($start.depth);
          const paragraphEnd = $start.after($start.depth);

          commands.insertContentAt({ from: paragraphStart, to: paragraphEnd }, detailsNode);
          const summarySize = detailsNode.firstChild?.nodeSize ?? 0;
          commands.setTextSelection(paragraphStart + 1 + summarySize + 1);
          return null;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: detailsClickPluginKey,
        props: {
          handleClick(view, pos, event) {
            // event.target can be a Text node, which doesn't have closest()
            const target = event.target;
            if (!(target instanceof Element)) return false;
            const summary = target.closest("summary, .details-summary");
            if (!summary) return false;

            const $pos = view.state.doc.resolve(pos);
            for (let d = $pos.depth; d >= 0; d--) {
              const node = $pos.node(d);
              if (node.type.name === "detailsBlock") {
                const nodePos = $pos.before(d);
                const tr = view.state.tr.setNodeMarkup(nodePos, null, {
                  ...node.attrs,
                  open: !node.attrs.open,
                });
                // Toggle is UI state, not content change - don't add to history
                view.dispatch(tr.setMeta("addToHistory", false));
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});
