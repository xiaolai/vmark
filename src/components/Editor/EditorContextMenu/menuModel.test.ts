// WI-1.2 — table-driven tests for the pure editor context-menu model
// builder: section visibility (hide vs disable policy), clipboard enable
// states, checkmarks, submenu states, link-aware swap, format-policy and
// code-block reductions. WI-1.3 — descriptor drift tests against
// TOOLBAR_GROUPS and the shortcut definitions. WI-3.4 — the restricted
// format-policy cases here are the reduced-menu verification.

import { describe, expect, it } from "vitest";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";
import {
  buildEditorContextMenu,
  CONTEXT_MENU_DESCRIPTORS,
  type EditorMenuAction,
  type EditorMenuItem,
  type EditorMenuSection,
  type EditorMenuSubmenu,
} from "./menuModel";
import { TOOLBAR_GROUPS, isSeparator } from "@/components/Editor/UniversalToolbar/toolbarGroups";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";

function snapshot(overrides: Partial<EditorContextMenuSnapshot> = {}): EditorContextMenuSnapshot {
  return {
    surface: "wysiwyg",
    selectionEmpty: true,
    inCodeBlock: false,
    headingLevel: null,
    listType: null,
    inBlockquote: false,
    link: null,
    formatPolicy: { paragraphFormatting: true, insertBlockActions: true },
    activeActions: [],
    disabledActions: [],
    ...overrides,
  };
}

function sectionIds(sections: EditorMenuSection[]): string[] {
  return sections.map((s) => s.id);
}

function findItem(sections: EditorMenuSection[], id: string): EditorMenuItem | undefined {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.id === id) return item;
      if (item.kind === "submenu") {
        const child = item.items.find((c) => c.id === id);
        if (child) return child;
      }
    }
  }
  return undefined;
}

function action(sections: EditorMenuSection[], id: string): EditorMenuAction {
  const item = findItem(sections, id);
  if (!item || item.kind !== "action") throw new Error(`no action item ${id}`);
  return item;
}

function submenu(sections: EditorMenuSection[], id: string): EditorMenuSubmenu {
  const item = findItem(sections, id);
  if (!item || item.kind !== "submenu") throw new Error(`no submenu ${id}`);
  return item;
}

describe("buildEditorContextMenu — sections", () => {
  it("shows all five sections in a markdown text block", () => {
    const sections = buildEditorContextMenu(snapshot());
    expect(sectionIds(sections)).toEqual([
      "clipboard",
      "selection",
      "inline",
      "block",
      "link",
    ]);
  });

  it("hides inline, block, and link sections inside a code block", () => {
    const sections = buildEditorContextMenu(snapshot({ inCodeBlock: true }));
    expect(sectionIds(sections)).toEqual(["clipboard", "selection"]);
  });

  it("hides formatting sections when paragraphFormatting policy is off", () => {
    const sections = buildEditorContextMenu(
      snapshot({ formatPolicy: { paragraphFormatting: false, insertBlockActions: false } })
    );
    expect(sectionIds(sections)).toEqual(["clipboard", "selection"]);
  });

  it("keeps the link section when only insertBlockActions is allowed", () => {
    const sections = buildEditorContextMenu(
      snapshot({ formatPolicy: { paragraphFormatting: false, insertBlockActions: true } })
    );
    expect(sectionIds(sections)).toEqual(["clipboard", "selection", "link"]);
  });

  it("hides the code-block item but keeps the block section when insertBlockActions is off", () => {
    const sections = buildEditorContextMenu(
      snapshot({ formatPolicy: { paragraphFormatting: true, insertBlockActions: false } })
    );
    expect(sectionIds(sections)).toEqual(["clipboard", "selection", "inline", "block"]);
    expect(findItem(sections, "codeBlock")).toBeUndefined();
  });
});

describe("buildEditorContextMenu — clipboard", () => {
  it("disables Cut and Copy on an empty selection, keeps Paste and Select All", () => {
    const sections = buildEditorContextMenu(snapshot({ selectionEmpty: true }));
    expect(action(sections, "cut").disabled).toBe(true);
    expect(action(sections, "copy").disabled).toBe(true);
    expect(action(sections, "paste").disabled).toBe(false);
    expect(action(sections, "selectAll").disabled).toBe(false);
  });

  it("enables Cut and Copy when there is a selection", () => {
    const sections = buildEditorContextMenu(snapshot({ selectionEmpty: false }));
    expect(action(sections, "cut").disabled).toBe(false);
    expect(action(sections, "copy").disabled).toBe(false);
  });

  it("routes clipboard items through the clipboard command runner", () => {
    const sections = buildEditorContextMenu(snapshot());
    expect(action(sections, "paste").run).toEqual({ type: "clipboard", command: "paste" });
    expect(action(sections, "selectAll").run).toEqual({ type: "clipboard", command: "selectAll" });
  });
});

describe("buildEditorContextMenu — inline formatting", () => {
  it("checks active marks and leaves the rest unchecked", () => {
    const sections = buildEditorContextMenu(
      snapshot({ activeActions: ["bold", "code"] })
    );
    expect(action(sections, "bold").checked).toBe(true);
    expect(action(sections, "code").checked).toBe(true);
    expect(action(sections, "italic").checked).toBe(false);
  });

  it("disables items listed in disabledActions (multi-selection / link rules)", () => {
    const sections = buildEditorContextMenu(snapshot({ disabledActions: ["code", "bold"] }));
    expect(action(sections, "code").disabled).toBe(true);
    expect(action(sections, "bold").disabled).toBe(true);
    expect(action(sections, "italic").disabled).toBe(false);
  });

  it("routes formatting items through the adapter runner", () => {
    const sections = buildEditorContextMenu(snapshot());
    expect(action(sections, "bold").run).toEqual({ type: "adapter", action: "bold" });
  });
});

describe("buildEditorContextMenu — heading submenu", () => {
  it("checks the current heading level", () => {
    const sections = buildEditorContextMenu(snapshot({ headingLevel: 2 }));
    const heading = submenu(sections, "heading");
    expect(heading.items.find((i) => i.id === "heading2")?.checked).toBe(true);
    expect(heading.items.find((i) => i.id === "heading1")?.checked).toBe(false);
    expect(heading.items.find((i) => i.id === "paragraph")?.checked).toBe(false);
  });

  it("checks Paragraph when not in a heading", () => {
    const sections = buildEditorContextMenu(snapshot({ headingLevel: null }));
    const heading = submenu(sections, "heading");
    expect(heading.items.find((i) => i.id === "paragraph")?.checked).toBe(true);
  });

  it("disables the submenu parent when every child is disabled", () => {
    const sections = buildEditorContextMenu(
      snapshot({
        disabledActions: [
          "heading:0", "heading:1", "heading:2", "heading:3",
          "heading:4", "heading:5", "heading:6",
        ],
      })
    );
    expect(submenu(sections, "heading").disabled).toBe(true);
  });

  it("keeps the submenu parent enabled while any child is enabled", () => {
    const sections = buildEditorContextMenu(snapshot({ disabledActions: ["heading:1"] }));
    const heading = submenu(sections, "heading");
    expect(heading.disabled).toBe(false);
    expect(heading.items.find((i) => i.id === "heading1")?.disabled).toBe(true);
  });
});

describe("buildEditorContextMenu — list submenu and block items", () => {
  it("checks the current list type", () => {
    const sections = buildEditorContextMenu(snapshot({ listType: "task" }));
    const list = submenu(sections, "list");
    expect(list.items.find((i) => i.id === "taskList")?.checked).toBe(true);
    expect(list.items.find((i) => i.id === "bulletList")?.checked).toBe(false);
  });

  it("checks Blockquote inside a blockquote", () => {
    const sections = buildEditorContextMenu(snapshot({ inBlockquote: true }));
    expect(action(sections, "blockquote").checked).toBe(true);
  });
});

describe("buildEditorContextMenu — link section", () => {
  it("offers Insert Link when not on a link", () => {
    const sections = buildEditorContextMenu(snapshot({ link: null }));
    expect(action(sections, "insertLink").run).toEqual({ type: "adapter", action: "link" });
    expect(findItem(sections, "editLink")).toBeUndefined();
  });

  it("swaps to Edit/Copy/Remove Link on a WYSIWYG link", () => {
    const sections = buildEditorContextMenu(
      snapshot({ link: { href: "https://example.com" } })
    );
    expect(findItem(sections, "insertLink")).toBeUndefined();
    expect(action(sections, "editLink").run).toEqual({ type: "link", command: "editLink" });
    expect(action(sections, "copyLink").disabled).toBe(false);
    expect(action(sections, "removeLink").run).toEqual({ type: "link", command: "removeLink" });
  });

  it("omits Edit Link in source mode and disables Copy Link on unresolved targets", () => {
    const sections = buildEditorContextMenu(
      snapshot({ surface: "source", link: { href: null } })
    );
    expect(findItem(sections, "editLink")).toBeUndefined();
    expect(action(sections, "copyLink").disabled).toBe(true);
    expect(action(sections, "removeLink").disabled).toBe(false);
  });

  it("disables Insert Link when the enable rules disable the link action", () => {
    const sections = buildEditorContextMenu(snapshot({ disabledActions: ["link"] }));
    expect(action(sections, "insertLink").disabled).toBe(true);
  });
});

describe("descriptor drift guards (WI-1.3)", () => {
  const toolbarActions = new Set(
    TOOLBAR_GROUPS.flatMap((g) => g.items)
      .filter((i) => !isSeparator(i))
      .map((i) => (i as { action: string }).action)
  );
  const shortcutIds = new Set(DEFAULT_SHORTCUTS.map((d) => d.id));

  it("every adapter-backed descriptor uses an action string the toolbar also uses", () => {
    for (const d of CONTEXT_MENU_DESCRIPTORS) {
      if (d.run.type !== "adapter") continue;
      expect(toolbarActions.has(d.run.action), `unknown adapter action ${d.run.action}`).toBe(true);
    }
  });

  it("every shortcutId exists in the shortcut definitions", () => {
    for (const d of CONTEXT_MENU_DESCRIPTORS) {
      if (!d.shortcutId) continue;
      expect(shortcutIds.has(d.shortcutId), `unknown shortcutId ${d.shortcutId}`).toBe(true);
    }
  });

  it("descriptor ids are unique", () => {
    const ids = CONTEXT_MENU_DESCRIPTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
