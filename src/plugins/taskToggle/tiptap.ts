import { mergeAttributes, Node } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const taskCheckboxPluginKey = new PluginKey("taskCheckbox");

function findListItemAtCursor(state: EditorState): { pos: number; node: unknown } | null {
  const { $from } = state.selection;
  const listItemType = state.schema.nodes.listItem;
  if (!listItemType) return null;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === listItemType) {
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

function findParentListAtCursor(state: EditorState): { pos: number; name: string } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "bulletList" || name === "orderedList") {
      return { pos: $from.before(d), name };
    }
  }
  return null;
}

function toggleTaskCheckbox(state: EditorState, dispatch?: EditorView["dispatch"]): boolean {
  const listItemInfo = findListItemAtCursor(state);
  if (!listItemInfo) return false;

  const listItem = listItemInfo.node as { attrs?: Record<string, unknown> };
  const checked = listItem.attrs?.checked;
  const nextChecked = checked === true ? false : checked === false ? true : false;

  const tr = state.tr;

  const listInfo = findParentListAtCursor(state);
  const bulletListType = state.schema.nodes.bulletList;
  if (listInfo?.name === "orderedList" && bulletListType) {
    tr.setNodeMarkup(listInfo.pos, bulletListType);
  }

  tr.setNodeMarkup(listItemInfo.pos, undefined, {
    ...(listItem.attrs ?? {}),
    checked: nextChecked,
  });

  dispatch?.(tr.scrollIntoView());
  return true;
}

export const taskListItemExtension = Node.create({
  name: "listItem",
  content: "paragraph block*",
  defining: true,

  addAttributes() {
    return {
      checked: {
        default: null,
        parseHTML: (element) => {
          const checkbox = (element as HTMLElement).querySelector('input[type="checkbox"]');
          if (!checkbox) return null;
          return (checkbox as HTMLInputElement).checked;
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "li" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const checked = node.attrs.checked as unknown;
    const isTask = checked === true || checked === false;

    const className = [HTMLAttributes.class, isTask ? "task-list-item" : ""].filter(Boolean).join(" ");
    const attrs = mergeAttributes(HTMLAttributes, className ? { class: className } : {});

    if (!isTask) return ["li", attrs, 0];

    const inputAttrs: Record<string, string> = {
      type: "checkbox",
      contenteditable: "false",
      "data-task-checkbox": "true",
    };
    if (checked) inputAttrs.checked = "checked";

    return [
      "li",
      attrs,
      ["span", { class: "task-list-checkbox", contenteditable: "false" }, ["input", inputAttrs]],
      ["span", { class: "task-list-content" }, 0],
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
      "Mod-Shift-Enter": () => toggleTaskCheckbox(this.editor.view.state, this.editor.view.dispatch),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: taskCheckboxPluginKey,
        props: {
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            const checkbox = target.closest('input[type="checkbox"][data-task-checkbox="true"]');
            if (!checkbox) return false;

            event.preventDefault();
            view.focus();

            const $pos = view.state.doc.resolve(pos);
            for (let d = $pos.depth; d > 0; d--) {
              const node = $pos.node(d);
              if (node.type.name !== "listItem") continue;

              const checked = node.attrs.checked;
              if (checked !== true && checked !== false) return false;

              const nodePos = $pos.before(d);
              const tr = view.state.tr.setNodeMarkup(nodePos, null, { ...node.attrs, checked: !checked });
              view.dispatch(tr);
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
