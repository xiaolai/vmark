/**
 * Slash Menu (/) - Block Insertion Commands
 *
 * Provides quick access to insert blocks like headings, lists, code blocks, etc.
 */

import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node } from "@milkdown/kit/prose/model";
import { callCommand } from "@milkdown/kit/utils";
import {
  wrapInHeadingCommand,
  wrapInBlockquoteCommand,
  insertHrCommand,
  createCodeBlockCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  turnIntoTextCommand,
  liftListItemCommand,
} from "@milkdown/kit/preset/commonmark";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import { open, message } from "@tauri-apps/plugin-dialog";
import { mathBlockSchema } from "@/plugins/latex/math-block-schema";
import { mermaidBlockSchema } from "@/plugins/mermaid/mermaid-block-schema";
import {
  insertFootnote,
  openPopupForNewFootnote,
} from "@/plugins/footnotePopup/footnoteUtils";
import { useDocumentStore } from "@/stores/documentStore";
import { copyImageToAssets, insertImageNode, insertBlockImageNode } from "@/utils/imageUtils";
import { getWindowLabel } from "@/utils/windowFocus";
import { createTriggerMenu } from "../factory";
import type { TriggerMenuItem } from "../types";
import { expandedToggleMark } from "@/plugins/editorPlugins";

// Per-window re-entry guard for image insertion
const insertingImageWindows = new Set<string>();

/**
 * Get info about the current block context.
 */
interface BlockInfo {
  type: string;
  pos: number;
  // Node type is complex - ProseMirror Node
  node: Node;
}

/**
 * Get the parent list info if cursor is inside a list.
 */
function getParentList(ctx: Ctx): BlockInfo | null {
  const view = ctx.get(editorViewCtx);
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "bullet_list" || node.type.name === "ordered_list") {
      return { type: node.type.name, pos: $from.before(d), node };
    }
  }
  return null;
}

/**
 * Convert entire list to a different list type (bullet <-> ordered).
 * Changes all items at once by replacing the list node.
 * Also clears checked attribute to convert task lists to regular lists.
 */
function convertListType(ctx: Ctx, targetType: "bullet_list" | "ordered_list"): boolean {
  const listInfo = getParentList(ctx);
  if (!listInfo) return false;

  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { schema } = state;
  const targetNodeType = schema.nodes[targetType];
  const listItemType = schema.nodes["list_item"];
  if (!targetNodeType || !listItemType) return false;

  // Get the list node
  const $pos = state.doc.resolve(listInfo.pos);
  const listNode = $pos.nodeAfter;
  if (!listNode) return false;

  // Check if this is a task list (any item has checked != null)
  let isTaskList = false;
  listNode.forEach((item) => {
    if (item.attrs.checked != null) isTaskList = true;
  });

  // If already correct type and not a task list, no-op
  if (listInfo.type === targetType && !isTaskList) return true;

  // Build new list items, clearing checked attribute
  const newItems: Node[] = [];
  listNode.forEach((item) => {
    const newAttrs = { ...item.attrs, checked: null };
    newItems.push(listItemType.create(newAttrs, item.content, item.marks));
  });

  // Create new list with cleared task status
  const newList = targetNodeType.create(listNode.attrs, newItems, listNode.marks);

  // Replace the old list with the new one
  const tr = state.tr.replaceWith(listInfo.pos, listInfo.pos + listNode.nodeSize, newList);
  view.dispatch(tr);
  return true;
}

/**
 * Normalize current block to a plain paragraph.
 * Handles lists (lifts out), headings, blockquotes, code blocks, etc.
 */
function normalizeToParagraph(ctx: Ctx) {
  // If inside a list, lift out of it first
  let maxAttempts = 10;
  while (getParentList(ctx) && maxAttempts > 0) {
    callCommand(liftListItemCommand.key)(ctx);
    maxAttempts--;
  }
  // Turn into plain text/paragraph (for headings, blockquotes, code blocks, etc.)
  callCommand(turnIntoTextCommand.key)(ctx);
}

/**
 * Helper: First normalize to paragraph, then apply block command.
 * This ensures conversions work (e.g., heading → list).
 */
function convertBlock(ctx: Ctx, command: () => void) {
  normalizeToParagraph(ctx);
  command();
}

/**
 * Get the current list item info if cursor is inside one.
 */
function getCurrentListItem(ctx: Ctx): { pos: number; node: Node } | null {
  const view = ctx.get(editorViewCtx);
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "list_item") {
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

/**
 * Convert current block/list to task list format.
 * Uses Milkdown's checked attribute on list_item nodes.
 */
function convertToTaskList(ctx: Ctx) {
  const listInfo = getParentList(ctx);

  if (!listInfo) {
    // Not in a list - first create a bullet list, then convert to task
    normalizeToParagraph(ctx);
    callCommand(wrapInBulletListCommand.key)(ctx);

    // Now set checked=false on the list item we just created
    const listItemInfo = getCurrentListItem(ctx);
    if (listItemInfo) {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const tr = state.tr.setNodeMarkup(listItemInfo.pos, undefined, {
        ...listItemInfo.node.attrs,
        checked: false,
      });
      view.dispatch(tr);
    }
    return;
  }

  // In a list - set checked=false on all list items
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { schema } = state;
  const bulletListType = schema.nodes["bullet_list"];
  const listItemType = schema.nodes["list_item"];

  if (!bulletListType || !listItemType) return;

  // Get the list node
  const $pos = state.doc.resolve(listInfo.pos);
  const listNode = $pos.nodeAfter;
  if (!listNode) return;

  // Build new list items with checked attribute set
  const newItems: Node[] = [];
  listNode.forEach((item) => {
    // Set checked=false if not already a task item
    const newAttrs = {
      ...item.attrs,
      checked: item.attrs.checked ?? false,
    };
    newItems.push(listItemType.create(newAttrs, item.content, item.marks));
  });

  // Create bullet list with task items (always bullet for tasks)
  const newList = bulletListType.create(listNode.attrs, newItems, listNode.marks);

  // Replace the old list with the new one
  const tr = state.tr.replaceWith(listInfo.pos, listInfo.pos + listNode.nodeSize, newList);
  view.dispatch(tr);
}

/**
 * Helper function to open file dialog and insert an image.
 * @param ctx - Milkdown context
 * @param asBlock - If true, insert as block image; if false, insert inline
 */
function insertImageFromDialog(ctx: Ctx, asBlock: boolean): void {
  const windowLabel = getWindowLabel();

  // Per-window re-entry guard
  if (insertingImageWindows.has(windowLabel)) return;
  insertingImageWindows.add(windowLabel);

  const view = ctx.get(editorViewCtx);

  // Async operation - open file dialog
  (async () => {
    try {
      const result = await open({
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
          },
        ],
      });

      if (!result) return;

      // Handle both string and array results (array when multiple: true)
      const sourcePath = Array.isArray(result) ? result[0] : result;
      if (!sourcePath) return;

      const doc = useDocumentStore.getState().getDocument(windowLabel);
      const filePath = doc?.filePath;

      if (!filePath) {
        await message(
          "Please save the document first to insert images.",
          { title: "Unsaved Document", kind: "warning" }
        );
        return;
      }

      // Copy to assets folder and get relative path
      const relativePath = await copyImageToAssets(sourcePath, filePath);

      // Insert as block or inline based on parameter
      if (asBlock) {
        insertBlockImageNode(view, relativePath);
      } else {
        insertImageNode(view, relativePath);
      }
    } catch (error) {
      console.error("Failed to insert image:", error);
      await message("Failed to insert image.", { kind: "error" });
    } finally {
      insertingImageWindows.delete(windowLabel);
    }
  })();
}

/**
 * Lucide-style SVG icons (24x24 viewBox, stroke-based)
 */
const icons = {
  paragraph: `<svg viewBox="0 0 24 24"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 1 0 0 9H13"/></svg>`,
  heading1: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>`,
  heading2: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>`,
  heading3: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>`,
  heading4: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 10v4h4"/><path d="M21 10v8"/></svg>`,
  heading5: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 18h4c0-3-4-4-4-7h4"/></svg>`,
  heading6: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><circle cx="19" cy="16" r="2"/><path d="M20 10c-2 0-3 1.5-3 4"/></svg>`,
  quote: `<svg viewBox="0 0 24 24"><path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/></svg>`,
  minus: `<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>`,
  list: `<svg viewBox="0 0 24 24"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
  listOrdered: `<svg viewBox="0 0 24 24"><line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`,
  listTodo: `<svg viewBox="0 0 24 24"><rect width="6" height="6" x="3" y="5" rx="1"/><path d="m3 17 2 2 4-4"/><line x1="13" x2="21" y1="6" y2="6"/><line x1="13" x2="21" y1="12" y2="12"/><line x1="13" x2="21" y1="18" y2="18"/></svg>`,
  image: `<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  code: `<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  table: `<svg viewBox="0 0 24 24"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>`,
  sigma: `<svg viewBox="0 0 24 24"><path d="M18 7V4H6l6 8-6 8h12v-3"/></svg>`,
  diagram: `<svg viewBox="0 0 24 24"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
  footnote: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M12 4h9"/><path d="M4 12h9"/><path d="M4 7V4h3"/><path d="M4 20v-3h3"/></svg>`,
  // Inline format icons
  bold: `<svg viewBox="0 0 24 24"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>`,
  italic: `<svg viewBox="0 0 24 24"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>`,
  strikethrough: `<svg viewBox="0 0 24 24"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>`,
  inlineCode: `<svg viewBox="0 0 24 24"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
  highlight: `<svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`,
  subscript: `<svg viewBox="0 0 24 24"><path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"/></svg>`,
  superscript: `<svg viewBox="0 0 24 24"><path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7c0-.472-.167-.933-.48-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.903 1.06"/></svg>`,
};

/**
 * Slash menu items with nested submenus.
 */
const slashMenuItems: TriggerMenuItem[] = [
  // Text submenu
  {
    label: "Text",
    icon: icons.paragraph,
    keywords: ["text", "paragraph", "heading", "quote", "h1", "h2", "h3"],
    children: [
      {
        label: "Paragraph",
        icon: icons.paragraph,
        keywords: ["text", "normal", "plain"],
        action: (ctx) => {
          normalizeToParagraph(ctx);
        },
      },
      {
        label: "Heading 1",
        icon: icons.heading1,
        keywords: ["h1", "title"],
        action: (ctx) => {
          convertBlock(ctx, () => callCommand(wrapInHeadingCommand.key, 1)(ctx));
        },
      },
      {
        label: "Heading 2",
        icon: icons.heading2,
        keywords: ["h2", "subtitle"],
        action: (ctx) => {
          convertBlock(ctx, () => callCommand(wrapInHeadingCommand.key, 2)(ctx));
        },
      },
      {
        label: "Heading 3",
        icon: icons.heading3,
        keywords: ["h3"],
        action: (ctx) => {
          convertBlock(ctx, () => callCommand(wrapInHeadingCommand.key, 3)(ctx));
        },
      },
      {
        label: "Heading 4",
        icon: icons.heading4,
        keywords: ["h4"],
        action: (ctx) => {
          convertBlock(ctx, () => callCommand(wrapInHeadingCommand.key, 4)(ctx));
        },
      },
      {
        label: "Heading 5",
        icon: icons.heading5,
        keywords: ["h5"],
        action: (ctx) => {
          convertBlock(ctx, () => callCommand(wrapInHeadingCommand.key, 5)(ctx));
        },
      },
      {
        label: "Heading 6",
        icon: icons.heading6,
        keywords: ["h6"],
        action: (ctx) => {
          convertBlock(ctx, () => callCommand(wrapInHeadingCommand.key, 6)(ctx));
        },
      },
      {
        label: "Quote",
        icon: icons.quote,
        keywords: ["blockquote", "citation"],
        action: (ctx) => {
          convertBlock(ctx, () => callCommand(wrapInBlockquoteCommand.key)(ctx));
        },
      },
    ],
  },

  // List submenu
  {
    label: "List",
    icon: icons.list,
    keywords: ["list", "bullet", "numbered", "task", "todo"],
    children: [
      {
        label: "Bullet List",
        icon: icons.list,
        keywords: ["ul", "unordered", "bullets"],
        action: (ctx) => {
          if (convertListType(ctx, "bullet_list")) return;
          convertBlock(ctx, () => callCommand(wrapInBulletListCommand.key)(ctx));
        },
      },
      {
        label: "Numbered List",
        icon: icons.listOrdered,
        keywords: ["ol", "ordered", "numbers"],
        action: (ctx) => {
          if (convertListType(ctx, "ordered_list")) return;
          convertBlock(ctx, () => callCommand(wrapInOrderedListCommand.key)(ctx));
        },
      },
      {
        label: "Task List",
        icon: icons.listTodo,
        keywords: ["todo", "checkbox", "checklist"],
        action: (ctx) => {
          convertToTaskList(ctx);
        },
      },
    ],
  },

  // Format submenu (inline formatting)
  {
    label: "Format",
    icon: icons.bold,
    keywords: ["format", "bold", "italic", "highlight", "code", "strikethrough"],
    children: [
      {
        label: "Bold",
        icon: icons.bold,
        keywords: ["strong", "weight"],
        action: (ctx) => {
          const view = ctx.get(editorViewCtx);
          expandedToggleMark(view, "strong");
        },
      },
      {
        label: "Italic",
        icon: icons.italic,
        keywords: ["emphasis", "slant"],
        action: (ctx) => {
          const view = ctx.get(editorViewCtx);
          expandedToggleMark(view, "emphasis");
        },
      },
      {
        label: "Highlight",
        icon: icons.highlight,
        keywords: ["mark", "yellow", "marker"],
        action: (ctx) => {
          const view = ctx.get(editorViewCtx);
          expandedToggleMark(view, "highlight");
        },
      },
      {
        label: "Strikethrough",
        icon: icons.strikethrough,
        keywords: ["strike", "delete", "cross"],
        action: (ctx) => {
          const view = ctx.get(editorViewCtx);
          expandedToggleMark(view, "strike_through");
        },
      },
      {
        label: "Inline Code",
        icon: icons.inlineCode,
        keywords: ["mono", "monospace", "backtick"],
        action: (ctx) => {
          const view = ctx.get(editorViewCtx);
          expandedToggleMark(view, "inlineCode");
        },
      },
      {
        label: "Subscript",
        icon: icons.subscript,
        keywords: ["sub", "below", "lower"],
        action: (ctx) => {
          const view = ctx.get(editorViewCtx);
          expandedToggleMark(view, "subscript");
        },
      },
      {
        label: "Superscript",
        icon: icons.superscript,
        keywords: ["sup", "above", "upper", "power"],
        action: (ctx) => {
          const view = ctx.get(editorViewCtx);
          expandedToggleMark(view, "superscript");
        },
      },
    ],
  },

  // Advanced submenu
  {
    label: "Advanced",
    icon: icons.code,
    keywords: ["code", "table", "math", "diagram", "mermaid", "image"],
    children: [
      {
        label: "Image",
        icon: icons.image,
        keywords: ["picture", "photo", "img", "block", "inline"],
        children: [
          {
            label: "Block",
            icon: icons.image,
            keywords: ["block", "standalone", "figure"],
            action: (ctx) => {
              insertImageFromDialog(ctx, true);
            },
          },
          {
            label: "Inline",
            icon: icons.image,
            keywords: ["inline", "text"],
            action: (ctx) => {
              insertImageFromDialog(ctx, false);
            },
          },
        ],
      },
      {
        label: "Code Block",
        icon: icons.code,
        keywords: ["pre", "code", "syntax", "programming"],
        action: (ctx) => {
          convertBlock(ctx, () => callCommand(createCodeBlockCommand.key)(ctx));
        },
      },
      {
        label: "Table",
        icon: icons.table,
        keywords: ["grid", "spreadsheet"],
        action: (ctx) => {
          callCommand(insertTableCommand.key, { row: 2, col: 2 })(ctx);
        },
      },
      {
        label: "Math Block",
        icon: icons.sigma,
        keywords: ["latex", "equation", "formula", "katex"],
        action: (ctx) => {
          normalizeToParagraph(ctx);
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const mathBlockType = mathBlockSchema.type(ctx);
          const node = mathBlockType.create();
          const tr = state.tr.replaceSelectionWith(node);
          view.dispatch(tr);
        },
      },
      {
        label: "Mermaid Diagram",
        icon: icons.diagram,
        keywords: ["diagram", "flowchart", "chart", "graph"],
        action: (ctx) => {
          normalizeToParagraph(ctx);
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const mermaidBlockType = mermaidBlockSchema.type(ctx);
          const defaultContent = "flowchart TD\n    A[Start] --> B[End]";
          const node = mermaidBlockType.create({}, state.schema.text(defaultContent));
          const tr = state.tr.replaceSelectionWith(node);
          view.dispatch(tr);
        },
      },
      {
        label: "Footnote",
        icon: icons.footnote,
        keywords: ["footnote", "note", "reference", "cite", "annotation"],
        action: (ctx) => {
          const result = insertFootnote(ctx);
          if (result) {
            const view = ctx.get(editorViewCtx);
            openPopupForNewFootnote(view, result.label, result.defPos);
          }
        },
      },
    ],
  },

  // Divider (top-level)
  {
    label: "Divider",
    icon: icons.minus,
    keywords: ["hr", "horizontal", "line", "separator"],
    action: (ctx) => {
      callCommand(insertHrCommand.key)(ctx);
    },
  },
];

// Create the slash menu using the factory
export const { plugin: slashMenu, configure: configureSlashMenu } = createTriggerMenu({
  id: "SLASH_MENU",
  trigger: "/",
  items: slashMenuItems,
});
