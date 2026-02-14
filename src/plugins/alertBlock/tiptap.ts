/**
 * Alert Block Tiptap Node
 *
 * Purpose: Defines the alertBlock node type for GitHub-style alert/admonition blocks
 * (NOTE, TIP, IMPORTANT, WARNING, CAUTION) in WYSIWYG mode.
 *
 * Key decisions:
 *   - alertType attribute is validated/normalized on both parse and render to prevent
 *     invalid values from persisting (e.g., from manual HTML edits or corrupted paste)
 *   - Insertion always creates a new block after the current position with an empty paragraph
 *
 * @coordinates-with codemirror/sourceAlertDecoration.ts — Source mode alert rendering
 * @coordinates-with shared/sourceLineAttr.ts — source line tracking for cursor sync
 * @module plugins/alertBlock/tiptap
 */

import { Node } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { sourceLineAttr } from "../shared/sourceLineAttr";

export const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const DEFAULT_ALERT_TYPE: AlertType = "NOTE";

/**
 * Validate and normalize an alertType value.
 * Returns a valid AlertType or the default if invalid.
 */
function normalizeAlertType(value: unknown): AlertType {
  if (typeof value !== "string") return DEFAULT_ALERT_TYPE;
  const upper = value.toUpperCase();
  return ALERT_TYPES.includes(upper as AlertType) ? (upper as AlertType) : DEFAULT_ALERT_TYPE;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    alertBlock: {
      insertAlertBlock: (alertType?: AlertType) => ReturnType;
    };
  }
}

function createAlertBlockNode(state: EditorState, alertType: AlertType) {
  const nodeType = state.schema.nodes.alertBlock;
  const paragraphType = state.schema.nodes.paragraph;
  if (!nodeType || !paragraphType) return null;
  return nodeType.create({ alertType }, [paragraphType.create()]);
}

export const alertBlockExtension = Node.create({
  name: "alertBlock",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      alertType: {
        default: DEFAULT_ALERT_TYPE,
        parseHTML: (element) => {
          const value = (element as HTMLElement).getAttribute("data-alert-type");
          return normalizeAlertType(value);
        },
        renderHTML: (attributes) => {
          return { "data-alert-type": normalizeAlertType(attributes.alertType) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-alert-type]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const alertType = normalizeAlertType(node.attrs.alertType);
    return [
      "div",
      {
        ...HTMLAttributes,
        class: `alert-block alert-${alertType.toLowerCase()}`,
      },
      ["div", { class: "alert-title", contenteditable: "false" }, alertType],
      ["div", { class: "alert-content" }, 0],
    ];
  },

  addCommands() {
    return {
      insertAlertBlock:
        (alertType = DEFAULT_ALERT_TYPE) =>
        ({ state, dispatch }) => {
          const alertNode = createAlertBlockNode(state, alertType);
          if (!alertNode) return false;

          const { $from } = state.selection;
          const insertPos = $from.end($from.depth) + 1;

          if (!dispatch) return true;

          const tr = state.tr.insert(insertPos, alertNode);
          tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 2)));
          dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
});
