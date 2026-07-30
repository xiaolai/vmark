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
 *   - A SELECTION is wrapped: the whole top-level blocks it spans become the
 *     body. Only an empty selection inserts a blank details block.
 *   - Default summary text for new blocks comes from the
 *     shared `blockTemplates` module, so both surfaces insert the same block
 *
 * @coordinates-with codemirror/sourceDetailsDecoration.ts — Source mode visual markers
 * @coordinates-with shared/sourceLineAttr.ts — source line tracking for cursor sync
 * @coordinates-with shared/blockInsertPos.ts — depth-aware insert position
 * @coordinates-with shared/blockTemplates.ts — summary text and open state
 * @coordinates-with shared/wrapBlocks.ts — how far the wrap reaches
 * @module plugins/detailsBlock/tiptap
 */

import { InputRule, Node } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { newDetailsSummary, NEW_DETAILS_OPEN } from "@/plugins/shared/blockTemplates";
import { blockInsertPos } from "../shared/blockInsertPos";
import { wrapSpannedBlocks } from "../shared/wrapBlocks";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import "./details-block.css";

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

  const summaryNode = summaryType.create(
    null,
    state.schema.text(newDetailsSummary()),
  );
  const contentNode = paragraphType.create();
  return detailsType.create({ open }, [summaryNode, contentNode]);
}

/** Tiptap node extension for the summary element inside a details block. */
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

/** Tiptap node extension for collapsible details/summary blocks. */
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
          // A selection is WRAPPED, not ignored — see alertBlock for the same
          // rule and `shared/blockSpan` for why it is whole blocks.
          const detailsType = state.schema.nodes.detailsBlock;
          const summaryType = state.schema.nodes.detailsSummary;
          const wrapping =
            detailsType && summaryType
              ? wrapSpannedBlocks(state, (content) =>
                  detailsType.create({ open: NEW_DETAILS_OPEN }, [
                    summaryType.create(null, state.schema.text(newDetailsSummary())),
                    ...content.content,
                  ]),
                )
              : null;
          if (wrapping) {
            if (dispatch) dispatch(wrapping);
            return true;
          }

          const detailsNode = createDetailsBlockNode(state, NEW_DETAILS_OPEN);
          if (!detailsNode) return false;

          const insertPos = blockInsertPos(state.selection);

          if (!dispatch) return true;

          const tr = state.tr.insert(insertPos, detailsNode);
          /* v8 ignore next -- @preserve null-coalesce: detailsNode always has a firstChild (summaryNode), nullish branch unreachable */
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
          const detailsNode = createDetailsBlockNode(state, NEW_DETAILS_OPEN);
          if (!detailsNode) return null;

          const $start = state.doc.resolve(range.from);
          const paragraphStart = $start.before($start.depth);
          const paragraphEnd = $start.after($start.depth);

          commands.insertContentAt({ from: paragraphStart, to: paragraphEnd }, detailsNode);
          /* v8 ignore next -- @preserve null-coalesce: detailsNode always has a firstChild (summaryNode), nullish branch unreachable */
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
