// WI-1.1 — popupStore `editorContextMenu` slice: open/close/reposition
// semantics for the editor right-click context menu (plan ADR-4).

import { beforeEach, describe, expect, it } from "vitest";
import { usePopupStore } from "../popupStore";
import { initialEditorContextMenu } from "../popupStore/slices";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

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

beforeEach(() => {
  usePopupStore.setState({ editorContextMenu: initialEditorContextMenu });
});

describe("editorContextMenu slice", () => {
  it("starts closed with no position or snapshot", () => {
    const s = usePopupStore.getState().editorContextMenu;
    expect(s.isOpen).toBe(false);
    expect(s.position).toBeNull();
    expect(s.snapshot).toBeNull();
  });

  it("opens with position and snapshot", () => {
    usePopupStore.getState().editorContextOpenMenu({
      position: { x: 120, y: 240 },
      snapshot: snapshot({ surface: "source" }),
    });
    const s = usePopupStore.getState().editorContextMenu;
    expect(s.isOpen).toBe(true);
    expect(s.position).toEqual({ x: 120, y: 240 });
    expect(s.snapshot?.surface).toBe("source");
  });

  it("repositions and replaces the snapshot on a second open (rapid re-invoke)", () => {
    const open = usePopupStore.getState().editorContextOpenMenu;
    open({ position: { x: 10, y: 10 }, snapshot: snapshot() });
    open({ position: { x: 300, y: 400 }, snapshot: snapshot({ inCodeBlock: true }) });
    const s = usePopupStore.getState().editorContextMenu;
    expect(s.isOpen).toBe(true);
    expect(s.position).toEqual({ x: 300, y: 400 });
    expect(s.snapshot?.inCodeBlock).toBe(true);
  });

  it("close resets to the initial state", () => {
    usePopupStore.getState().editorContextOpenMenu({
      position: { x: 1, y: 2 },
      snapshot: snapshot(),
    });
    usePopupStore.getState().editorContextCloseMenu();
    expect(usePopupStore.getState().editorContextMenu).toEqual(initialEditorContextMenu);
  });

  it("does not disturb sibling slices when opening", () => {
    const imageBefore = usePopupStore.getState().imageContextMenu;
    usePopupStore.getState().editorContextOpenMenu({
      position: { x: 5, y: 6 },
      snapshot: snapshot(),
    });
    expect(usePopupStore.getState().imageContextMenu).toBe(imageBefore);
  });
});
