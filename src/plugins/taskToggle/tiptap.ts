/**
 * Task Toggle Extension
 *
 * Purpose: Extends the listItem node with a `checked` attribute and adds a checkbox
 * NodeView for task list items. Clicking the checkbox toggles checked state, and
 * Mod+Enter toggles the checkbox at cursor via keyboard shortcut.
 *
 * Key decisions:
 *   - Checkbox is a real DOM <input type="checkbox"> for accessibility
 *   - Click handler uses stopPropagation to prevent ProseMirror selection change
 *   - Keyboard shortcut finds the listItem at cursor depth-first, toggles its checked attr
 *
 * @coordinates-with tiptapTaskListUtils.ts — task list toggle/untoggle commands
 * @coordinates-with shared/sourceLineAttr.ts — source-line tracking on list items
 * @module plugins/taskToggle/tiptap
 */
import { mergeAttributes, Node } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { sourceLineAttr } from "../shared/sourceLineAttr";

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

  // Explicitly mark as history entry for consistent undo behavior
  tr.setMeta("addToHistory", true);
  dispatch?.(tr.scrollIntoView());
  return true;
}

export const taskListItemExtension = Node.create({
  name: "listItem",
  content: "paragraph block*",
  defining: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      checked: {
        default: null,
        parseHTML: (element) => {
          // Use direct child selector to avoid picking checkbox from nested task lists
          const el = element as HTMLElement;
          const checkbox =
            el.querySelector(':scope > .task-list-checkbox input[type="checkbox"]') ??
            el.querySelector(':scope > input[type="checkbox"]');
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
    // Note: Tab/Shift-Tab for list indent/outdent is handled by tabIndentExtension
    // using ProseMirror's liftListItem/sinkListItem directly (our custom listItem
    // node doesn't register Tiptap commands).
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
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
              // Explicitly mark as history entry for consistent undo behavior
              tr.setMeta("addToHistory", true);
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
