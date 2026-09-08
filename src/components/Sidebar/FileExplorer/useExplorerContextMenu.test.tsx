// Audit 20260907 (#323) — the file explorer's context-menu state, and the
// rule that a workspace switch closes it: a menu opened on a file in one
// workspace used to stay open across the switch, its actions (delete, rename,
// duplicate…) still targeting the previous workspace's absolute path.
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TreeApi } from "react-arborist";
import { FILE_NODE_ID_ATTR, FILE_NODE_ROW_CLASS, type FileNode } from "./types";
import { menuStateForEvent, rowIdAt, useExplorerContextMenu } from "./useExplorerContextMenu";

function treeRef(nodes: Record<string, { id: string; isFolder: boolean }>) {
  return {
    current: { get: (id: string) => (nodes[id] ? { data: nodes[id] } : null) },
  } as unknown as React.RefObject<TreeApi<FileNode> | null>;
}

function rightClick(target: Element, x = 10, y = 20) {
  return {
    preventDefault: () => {},
    target,
    clientX: x,
    clientY: y,
  } as unknown as React.MouseEvent;
}

function nodeElement(id: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "file-node";
  el.setAttribute("data-node-id", id);
  document.body.appendChild(el);
  return el;
}

describe("useExplorerContextMenu", () => {
  it("opens on a tree node with that node's path and kind", () => {
    const ref = treeRef({ "/ws/a/notes.md": { id: "/ws/a/notes.md", isFolder: false } });
    const { result } = renderHook(() => useExplorerContextMenu("ws-a", ref));
    act(() => result.current.handleContextMenu(rightClick(nodeElement("/ws/a/notes.md"), 5, 7)));
    expect(result.current.contextMenu).toEqual({
      visible: true,
      type: "file",
      position: { x: 5, y: 7 },
      targetPath: "/ws/a/notes.md",
      targetIsFolder: false,
    });
  });

  it("opens on empty space with no target", () => {
    const { result } = renderHook(() => useExplorerContextMenu("ws-a", treeRef({})));
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    act(() => result.current.handleContextMenu(rightClick(empty)));
    expect(result.current.contextMenu).toMatchObject({ visible: true, type: "empty", targetPath: null });
  });

  // Audit R2 (#649): a row the tree cannot resolve — mid refresh, or filtered
  // out — used to fall through to the workspace menu, so "New File" and "New
  // Folder" aimed at the ROOT from a pointer sitting on a file.
  it("opens nothing when the clicked ROW cannot be resolved", () => {
    const { result } = renderHook(() => useExplorerContextMenu("ws-a", treeRef({})));
    act(() => result.current.handleContextMenu(rightClick(nodeElement("/ws/a/gone.md"))));
    expect(result.current.contextMenu).toMatchObject({ visible: false, targetPath: null });
  });

  it("an unresolvable row CLOSES a menu that was already open", () => {
    const ref = treeRef({ "/ws/a/notes.md": { id: "/ws/a/notes.md", isFolder: false } });
    const { result } = renderHook(() => useExplorerContextMenu("ws-a", ref));
    act(() => result.current.handleContextMenu(rightClick(nodeElement("/ws/a/notes.md"))));
    expect(result.current.contextMenu.visible).toBe(true);
    act(() => result.current.handleContextMenu(rightClick(nodeElement("/ws/a/gone.md"))));
    expect(result.current.contextMenu).toMatchObject({ visible: false, targetPath: null });
  });

  it("closeContextMenu hides it", () => {
    const { result } = renderHook(() => useExplorerContextMenu("ws-a", treeRef({})));
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    act(() => result.current.handleContextMenu(rightClick(empty)));
    act(() => result.current.closeContextMenu());
    expect(result.current.contextMenu.visible).toBe(false);
  });

  it("a workspace switch closes a menu opened in the previous workspace", () => {
    const ref = treeRef({ "/ws/a/notes.md": { id: "/ws/a/notes.md", isFolder: false } });
    const { result, rerender } = renderHook(({ key }: { key: string }) => useExplorerContextMenu(key, ref), {
      initialProps: { key: "ws-a" },
    });
    act(() => result.current.handleContextMenu(rightClick(nodeElement("/ws/a/notes.md"))));
    expect(result.current.contextMenu.visible).toBe(true);

    rerender({ key: "ws-b" });
    expect(result.current.contextMenu.visible).toBe(false);
    expect(result.current.contextMenu.targetPath).toBeNull();
  });

  it("switching back to the original workspace does not resurrect the old menu", () => {
    const ref = treeRef({ "/ws/a/notes.md": { id: "/ws/a/notes.md", isFolder: false } });
    const { result, rerender } = renderHook(({ key }: { key: string }) => useExplorerContextMenu(key, ref), {
      initialProps: { key: "ws-a" },
    });
    act(() => result.current.handleContextMenu(rightClick(nodeElement("/ws/a/notes.md"))));
    rerender({ key: "ws-b" });
    rerender({ key: "ws-a" });
    expect(result.current.contextMenu.visible).toBe(false);
  });
});

// Audit R3 #647/#648 — the hit-testing, now a pure function, and the row
// markup contract it and `FileNode.tsx` share.
describe("menuStateForEvent — the hit test, without a right-click", () => {
  function row(id: string): HTMLElement {
    const el = document.createElement("div");
    el.className = FILE_NODE_ROW_CLASS;
    el.setAttribute(FILE_NODE_ID_ATTR, id);
    const child = document.createElement("span");
    el.appendChild(child);
    document.body.appendChild(el);
    return child;
  }

  const at = { x: 3, y: 4 };
  const treeWith = (id: string, isFolder: boolean) =>
    ({ get: (wanted: string) => (wanted === id ? { data: { id, isFolder } } : undefined) }) as never;

  it("opens the FILE menu over a file row, from a descendant of it", () => {
    expect(menuStateForEvent(row("/w/a.md"), at, treeWith("/w/a.md", false))).toEqual({
      visible: true,
      type: "file",
      position: at,
      targetPath: "/w/a.md",
      targetIsFolder: false,
    });
  });

  it("opens the FOLDER menu over a folder row", () => {
    expect(menuStateForEvent(row("/w/sub"), at, treeWith("/w/sub", true))).toMatchObject({
      type: "folder",
      targetIsFolder: true,
    });
  });

  it("opens the WORKSPACE menu over empty space", () => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    expect(menuStateForEvent(empty, at, treeWith("/w/a.md", false))).toEqual({
      visible: true,
      type: "empty",
      position: at,
      targetPath: null,
      targetIsFolder: false,
    });
  });

  it("opens NO menu over a row the tree cannot resolve (#649)", () => {
    expect(menuStateForEvent(row("/w/gone.md"), at, treeWith("/w/a.md", false)).visible).toBe(false);
  });

  it("treats a non-element target as empty space", () => {
    expect(menuStateForEvent(null, at, null)).toMatchObject({ visible: true, type: "empty" });
  });
});

describe("rowIdAt reads what FileNode writes (#648)", () => {
  it("resolves the id from the class and attribute the row markup uses", () => {
    // The two files write and read these names; the constants are what stop
    // them being two independent literals.
    const el = document.createElement("div");
    el.className = `${FILE_NODE_ROW_CLASS} active`;
    el.setAttribute(FILE_NODE_ID_ATTR, "/w/a.md");
    document.body.appendChild(el);
    expect(rowIdAt(el)).toBe("/w/a.md");
  });
});
