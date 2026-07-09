/**
 * Editor context-menu model — descriptors and the pure builder.
 *
 * Purpose: turns an `EditorContextMenuSnapshot` (normalized editor state
 * captured at right-click time) into the section/item model the renderer
 * displays. Pure data-in/data-out: no store reads, no editor objects, so
 * every context is table-testable (WI-1.2).
 *
 * Key decisions (plan ADR-6):
 *   - Explicit descriptors, nothing derived from TOOLBAR_GROUPS at
 *     runtime — the toolbar and the menu use different vocabularies for
 *     ids/shortcuts. Drift is caught by menuModel.test.ts (WI-1.3).
 *   - Hide vs disable: a section (or policy-gated item) inapplicable to
 *     the snapshot is hidden; an individually inapplicable item inside an
 *     applicable section renders disabled.
 *   - Clipboard items route to the native clipboard bridge, not the
 *     toolbar adapters (Cut/Copy/Paste are native roles — ADR-3).
 *
 * @coordinates-with types/editorContextMenu.ts — the snapshot contract
 * @coordinates-with EditorContextMenu.tsx — renders this model
 * @module components/Editor/EditorContextMenu/menuModel
 */

import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

/** How an activated item executes. */
export type EditorMenuRun =
  | { type: "adapter"; action: string }
  | { type: "clipboard"; command: "cut" | "copy" | "paste" | "selectAll" }
  | { type: "link"; command: "editLink" | "copyLink" | "removeLink" };

export interface EditorMenuAction {
  kind: "action";
  id: string;
  /** Key inside the `editor` namespace (e.g. "contextMenu.bold"). */
  labelKey: string;
  run: EditorMenuRun;
  /** Icon registry id resolved by the renderer (lucide component map). */
  iconId?: string;
  /** Settings-store shortcut id (user-customizable bindings). */
  shortcutId?: string;
  /** Fixed store-format key ("Mod-x") for native roles that are not
   *  rebindable in the app; formatted by the renderer. */
  shortcutKey?: string;
  /** True for toggle-style items (marks, heading levels, list types,
   *  blockquote) — rendered as `menuitemcheckbox`. */
  checkable: boolean;
  checked: boolean;
  disabled: boolean;
}

export interface EditorMenuSubmenu {
  kind: "submenu";
  id: string;
  labelKey: string;
  iconId?: string;
  items: EditorMenuAction[];
  /** True when every child is disabled. */
  disabled: boolean;
}

export type EditorMenuItem = EditorMenuAction | EditorMenuSubmenu;

export interface EditorMenuSection {
  id: string;
  items: EditorMenuItem[];
}

/** Static descriptor an item is built from (WI-1.3 drift-guard surface). */
export interface ContextMenuItemDescriptor {
  id: string;
  labelKey: string;
  run: EditorMenuRun;
  iconId?: string;
  shortcutId?: string;
  shortcutKey?: string;
  checkable?: boolean;
}

const CLIPBOARD_ITEMS: ContextMenuItemDescriptor[] = [
  { id: "cut", labelKey: "contextMenu.cut", run: { type: "clipboard", command: "cut" }, iconId: "cut", shortcutKey: "Mod-x" },
  { id: "copy", labelKey: "contextMenu.copy", run: { type: "clipboard", command: "copy" }, iconId: "copy", shortcutKey: "Mod-c" },
  { id: "paste", labelKey: "contextMenu.paste", run: { type: "clipboard", command: "paste" }, iconId: "paste", shortcutKey: "Mod-v" },
];

const SELECT_ALL_ITEM: ContextMenuItemDescriptor = {
  id: "selectAll", labelKey: "contextMenu.selectAll", run: { type: "clipboard", command: "selectAll" }, iconId: "selectAll", shortcutKey: "Mod-a",
};

const INLINE_ITEMS: ContextMenuItemDescriptor[] = [
  { id: "bold", labelKey: "contextMenu.bold", run: { type: "adapter", action: "bold" }, iconId: "bold", shortcutId: "bold", checkable: true },
  { id: "italic", labelKey: "contextMenu.italic", run: { type: "adapter", action: "italic" }, iconId: "italic", shortcutId: "italic", checkable: true },
  { id: "strikethrough", labelKey: "contextMenu.strikethrough", run: { type: "adapter", action: "strikethrough" }, iconId: "strikethrough", shortcutId: "strikethrough", checkable: true },
  { id: "code", labelKey: "contextMenu.inlineCode", run: { type: "adapter", action: "code" }, iconId: "code", shortcutId: "code", checkable: true },
];

const HEADING_CHILDREN: ContextMenuItemDescriptor[] = [
  { id: "paragraph", labelKey: "contextMenu.paragraph", run: { type: "adapter", action: "heading:0" }, shortcutId: "paragraph", checkable: true },
  { id: "heading1", labelKey: "contextMenu.heading1", run: { type: "adapter", action: "heading:1" }, shortcutId: "heading1", checkable: true },
  { id: "heading2", labelKey: "contextMenu.heading2", run: { type: "adapter", action: "heading:2" }, shortcutId: "heading2", checkable: true },
  { id: "heading3", labelKey: "contextMenu.heading3", run: { type: "adapter", action: "heading:3" }, shortcutId: "heading3", checkable: true },
  { id: "heading4", labelKey: "contextMenu.heading4", run: { type: "adapter", action: "heading:4" }, shortcutId: "heading4", checkable: true },
  { id: "heading5", labelKey: "contextMenu.heading5", run: { type: "adapter", action: "heading:5" }, shortcutId: "heading5", checkable: true },
  { id: "heading6", labelKey: "contextMenu.heading6", run: { type: "adapter", action: "heading:6" }, shortcutId: "heading6", checkable: true },
];

const LIST_CHILDREN: ContextMenuItemDescriptor[] = [
  { id: "bulletList", labelKey: "contextMenu.bulletList", run: { type: "adapter", action: "bulletList" }, shortcutId: "bulletList", checkable: true },
  { id: "orderedList", labelKey: "contextMenu.orderedList", run: { type: "adapter", action: "orderedList" }, shortcutId: "orderedList", checkable: true },
  { id: "taskList", labelKey: "contextMenu.taskList", run: { type: "adapter", action: "taskList" }, shortcutId: "taskList", checkable: true },
];

const BLOCKQUOTE_ITEM: ContextMenuItemDescriptor = {
  id: "blockquote", labelKey: "contextMenu.blockquote", run: { type: "adapter", action: "insertBlockquote" }, iconId: "blockquote", shortcutId: "blockquote", checkable: true,
};

const CODE_BLOCK_ITEM: ContextMenuItemDescriptor = {
  id: "codeBlock", labelKey: "contextMenu.codeBlock", run: { type: "adapter", action: "insertCodeBlock" }, iconId: "codeBlock", shortcutId: "codeBlock",
};

const INSERT_LINK_ITEM: ContextMenuItemDescriptor = {
  id: "insertLink", labelKey: "contextMenu.insertLink", run: { type: "adapter", action: "link" }, iconId: "link", shortcutId: "link",
};

const EDIT_LINK_ITEM: ContextMenuItemDescriptor = {
  id: "editLink", labelKey: "contextMenu.editLink", run: { type: "link", command: "editLink" }, iconId: "link",
};
const COPY_LINK_ITEM: ContextMenuItemDescriptor = {
  id: "copyLink", labelKey: "contextMenu.copyLink", run: { type: "link", command: "copyLink" }, iconId: "copy",
};
const REMOVE_LINK_ITEM: ContextMenuItemDescriptor = {
  id: "removeLink", labelKey: "contextMenu.removeLink", run: { type: "link", command: "removeLink" }, iconId: "unlink", shortcutId: "unlink",
};

/** Every descriptor, exported for the WI-1.3 drift tests. */
export const CONTEXT_MENU_DESCRIPTORS: ContextMenuItemDescriptor[] = [
  ...CLIPBOARD_ITEMS,
  SELECT_ALL_ITEM,
  ...INLINE_ITEMS,
  ...HEADING_CHILDREN,
  ...LIST_CHILDREN,
  BLOCKQUOTE_ITEM,
  CODE_BLOCK_ITEM,
  INSERT_LINK_ITEM,
  EDIT_LINK_ITEM,
  COPY_LINK_ITEM,
  REMOVE_LINK_ITEM,
];

function toAction(
  d: ContextMenuItemDescriptor,
  opts: { checked?: boolean; disabled?: boolean } = {}
): EditorMenuAction {
  return {
    kind: "action",
    id: d.id,
    labelKey: d.labelKey,
    run: d.run,
    iconId: d.iconId,
    shortcutId: d.shortcutId,
    shortcutKey: d.shortcutKey,
    checkable: d.checkable ?? false,
    checked: opts.checked ?? false,
    disabled: opts.disabled ?? false,
  };
}

function adapterAction(d: ContextMenuItemDescriptor): string {
  /* v8 ignore next -- @preserve all callers pass adapter-run descriptors; guard keeps the cast honest */
  return d.run.type === "adapter" ? d.run.action : "";
}

function fromRules(
  d: ContextMenuItemDescriptor,
  snapshot: EditorContextMenuSnapshot,
  checked: boolean
): EditorMenuAction {
  return toAction(d, {
    checked,
    disabled: snapshot.disabledActions.includes(adapterAction(d)),
  });
}

function buildHeadingSubmenu(snapshot: EditorContextMenuSnapshot): EditorMenuSubmenu {
  const items = HEADING_CHILDREN.map((d) => {
    const level = Number(adapterAction(d).split(":")[1]);
    const checked = level === 0 ? snapshot.headingLevel === null : snapshot.headingLevel === level;
    return fromRules(d, snapshot, checked);
  });
  return {
    kind: "submenu",
    id: "heading",
    labelKey: "contextMenu.heading",
    iconId: "heading",
    items,
    disabled: items.every((i) => i.disabled),
  };
}

function buildListSubmenu(snapshot: EditorContextMenuSnapshot): EditorMenuSubmenu {
  const checkedByAction: Record<string, boolean> = {
    bulletList: snapshot.listType === "bullet",
    orderedList: snapshot.listType === "ordered",
    taskList: snapshot.listType === "task",
  };
  const items = LIST_CHILDREN.map((d) =>
    fromRules(d, snapshot, checkedByAction[adapterAction(d)] ?? false)
  );
  return {
    kind: "submenu",
    id: "list",
    labelKey: "contextMenu.list",
    iconId: "list",
    items,
    disabled: items.every((i) => i.disabled),
  };
}

function buildLinkSection(snapshot: EditorContextMenuSnapshot): EditorMenuSection {
  if (snapshot.link) {
    const items: EditorMenuAction[] = [];
    if (snapshot.surface === "wysiwyg") {
      items.push(toAction(EDIT_LINK_ITEM));
    }
    items.push(
      toAction(COPY_LINK_ITEM, { disabled: snapshot.link.href === null }),
      toAction(REMOVE_LINK_ITEM, {
        disabled: snapshot.disabledActions.includes("unlink"),
      })
    );
    return { id: "link", items };
  }
  return {
    id: "link",
    items: [fromRules(INSERT_LINK_ITEM, snapshot, false)],
  };
}

/**
 * Build the context-menu model for a snapshot. Sections whose every item
 * is inapplicable to the context are omitted entirely (hide policy);
 * items inside applicable sections carry `disabled` instead.
 */
export function buildEditorContextMenu(
  snapshot: EditorContextMenuSnapshot
): EditorMenuSection[] {
  const sections: EditorMenuSection[] = [
    {
      id: "clipboard",
      items: CLIPBOARD_ITEMS.map((d) =>
        toAction(d, {
          disabled: (d.id === "cut" || d.id === "copy") && snapshot.selectionEmpty,
        })
      ),
    },
    { id: "selection", items: [toAction(SELECT_ALL_ITEM)] },
  ];

  const showFormatting = !snapshot.inCodeBlock && snapshot.formatPolicy.paragraphFormatting;
  const showLinkSection = !snapshot.inCodeBlock && snapshot.formatPolicy.insertBlockActions;

  if (showFormatting) {
    sections.push({
      id: "inline",
      items: INLINE_ITEMS.map((d) =>
        fromRules(d, snapshot, snapshot.activeActions.includes(adapterAction(d)))
      ),
    });

    const blockItems: EditorMenuItem[] = [
      buildHeadingSubmenu(snapshot),
      buildListSubmenu(snapshot),
      fromRules(BLOCKQUOTE_ITEM, snapshot, snapshot.inBlockquote),
    ];
    if (snapshot.formatPolicy.insertBlockActions) {
      blockItems.push(fromRules(CODE_BLOCK_ITEM, snapshot, false));
    }
    sections.push({ id: "block", items: blockItems });
  }

  if (showLinkSection) {
    sections.push(buildLinkSection(snapshot));
  }

  return sections;
}
