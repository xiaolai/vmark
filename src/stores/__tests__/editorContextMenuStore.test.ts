// @vitest-environment node
// WI-9 (plan-20260803-161713) — editorContextMenuStore: open/close/reposition
// semantics for the editor right-click context menu. Converted from the former
// merged-store slice test (WI-1.1) when the slice was re-inlined as a
// standalone store; the open/close semantics are pinned unchanged.

import { beforeEach, describe, expect, it } from "vitest";
import { useEditorContextMenuStore } from "../editorContextMenuStore";
import { useImageContextMenuStore } from "../imageContextMenuStore";
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

const initialData = { isOpen: false, position: null, snapshot: null };

function dataOf(s: ReturnType<typeof useEditorContextMenuStore.getState>) {
  const { isOpen, position, snapshot: snap } = s;
  return { isOpen, position, snapshot: snap };
}

beforeEach(() => {
  useEditorContextMenuStore.setState(useEditorContextMenuStore.getInitialState());
});

describe("editorContextMenuStore", () => {
  it("starts closed with no position or snapshot", () => {
    const s = useEditorContextMenuStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.position).toBeNull();
    expect(s.snapshot).toBeNull();
  });

  it("opens with position and snapshot", () => {
    useEditorContextMenuStore.getState().openMenu({
      position: { x: 120, y: 240 },
      snapshot: snapshot({ surface: "source" }),
    });
    const s = useEditorContextMenuStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.position).toEqual({ x: 120, y: 240 });
    expect(s.snapshot?.surface).toBe("source");
  });

  it("repositions and replaces the snapshot on a second open (rapid re-invoke)", () => {
    const open = useEditorContextMenuStore.getState().openMenu;
    open({ position: { x: 10, y: 10 }, snapshot: snapshot() });
    open({ position: { x: 300, y: 400 }, snapshot: snapshot({ inCodeBlock: true }) });
    const s = useEditorContextMenuStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.position).toEqual({ x: 300, y: 400 });
    expect(s.snapshot?.inCodeBlock).toBe(true);
  });

  it("close resets to the initial state", () => {
    useEditorContextMenuStore.getState().openMenu({
      position: { x: 1, y: 2 },
      snapshot: snapshot(),
    });
    useEditorContextMenuStore.getState().closeMenu();
    expect(dataOf(useEditorContextMenuStore.getState())).toEqual(initialData);
  });

  it("does not disturb the image context menu store when opening", () => {
    const imageBefore = useImageContextMenuStore.getState();
    useEditorContextMenuStore.getState().openMenu({
      position: { x: 5, y: 6 },
      snapshot: snapshot(),
    });
    expect(useImageContextMenuStore.getState()).toBe(imageBefore);
  });
});

describe("editorContextMenuStore — T09 revert contract pins", () => {
  it("no leak across sessions: open A → close → open B shows only B", () => {
    useEditorContextMenuStore.getState().openMenu({
      position: { x: 1, y: 2 },
      snapshot: snapshot({ surface: "source", inCodeBlock: true }),
    });
    useEditorContextMenuStore.getState().closeMenu();

    const snapB = snapshot({ surface: "wysiwyg" });
    useEditorContextMenuStore.getState().openMenu({
      position: { x: 9, y: 9 },
      snapshot: snapB,
    });

    expect(dataOf(useEditorContextMenuStore.getState())).toEqual({
      isOpen: true,
      position: { x: 9, y: 9 },
      snapshot: snapB,
    });
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useEditorContextMenuStore.getState().openMenu({
        position: { x: i, y: i },
        snapshot: snapshot(),
      });
      useEditorContextMenuStore.getState().closeMenu();
    }
    expect(dataOf(useEditorContextMenuStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics", () => {
    it("getInitialState stays pristine after mutations", () => {
      useEditorContextMenuStore.getState().openMenu({
        position: { x: 7, y: 8 },
        snapshot: snapshot(),
      });
      expect(dataOf(useEditorContextMenuStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useEditorContextMenuStore.getState().openMenu({
        position: { x: 7, y: 8 },
        snapshot: snapshot(),
      });
      useEditorContextMenuStore.setState(useEditorContextMenuStore.getInitialState());
      expect(dataOf(useEditorContextMenuStore.getState())).toEqual(initialData);
    });
  });
});
