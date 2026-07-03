import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type { TreeApi } from "react-arborist";
import { useQuickLookStore } from "@/stores/quickLookStore";
import { useQuickLookHotkey } from "./useQuickLookHotkey";
import type { FileNode } from "./types";

// Build a minimal treeRef whose selectedNodes[0] + visibleNodes mirror
// react-arborist's shape.
function makeTreeRef(
  selected: { id: string; isFolder: boolean } | null,
  visible: { id: string; isFolder: boolean }[] = [],
): RefObject<TreeApi<FileNode> | null> {
  const selectedNodes = selected
    ? [{ data: { id: selected.id, isFolder: selected.isFolder } }]
    : [];
  const visibleNodes = visible.map((v) => ({ data: { id: v.id, isFolder: v.isFolder } }));
  return {
    current: { selectedNodes, visibleNodes } as unknown as TreeApi<FileNode>,
  };
}

function makeKeyEvent(
  key: string,
  opts: {
    target?: { tagName?: string; isContentEditable?: boolean } | null;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  } = {},
) {
  const preventDefault = vi.fn();
  return {
    event: {
      key,
      preventDefault,
      target: opts.target ?? null,
      shiftKey: opts.shiftKey ?? false,
      ctrlKey: opts.ctrlKey ?? false,
      metaKey: opts.metaKey ?? false,
      altKey: opts.altKey ?? false,
    } as unknown as React.KeyboardEvent,
    preventDefault,
  };
}

describe("useQuickLookHotkey", () => {
  beforeEach(() => {
    useQuickLookStore.setState({ isOpen: false, path: null, siblings: [], index: -1 });
  });

  it("opens Quick Look for the selected file on Space", () => {
    const ref = makeTreeRef({ id: "/ws/photo.png", isFolder: false });
    const { result } = renderHook(() => useQuickLookHotkey(ref));
    const { event, preventDefault } = makeKeyEvent(" ");

    result.current(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(useQuickLookStore.getState().isOpen).toBe(true);
    expect(useQuickLookStore.getState().path).toBe("/ws/photo.png");
  });

  it("passes the ordered visible files (folders excluded) as siblings", () => {
    const visible = [
      { id: "/ws/a.png", isFolder: false },
      { id: "/ws/sub", isFolder: true },
      { id: "/ws/b.mp4", isFolder: false },
      { id: "/ws/c.mp3", isFolder: false },
    ];
    const ref = makeTreeRef({ id: "/ws/b.mp4", isFolder: false }, visible);
    const { result } = renderHook(() => useQuickLookHotkey(ref));
    result.current(makeKeyEvent(" ").event);

    const s = useQuickLookStore.getState();
    // Folder dropped; display order preserved; index points at the opened file.
    expect(s.siblings).toEqual(["/ws/a.png", "/ws/b.mp4", "/ws/c.mp3"]);
    expect(s.index).toBe(1);
    expect(s.path).toBe("/ws/b.mp4");
  });

  it("ignores non-Space keys (does not disturb Enter/F2/arrows)", () => {
    const ref = makeTreeRef({ id: "/ws/photo.png", isFolder: false });
    const { result } = renderHook(() => useQuickLookHotkey(ref));
    const { event, preventDefault } = makeKeyEvent("Enter");

    result.current(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });

  it("does nothing when a folder is selected (lets arborist handle Space)", () => {
    const ref = makeTreeRef({ id: "/ws/dir", isFolder: true });
    const { result } = renderHook(() => useQuickLookHotkey(ref));
    const { event, preventDefault } = makeKeyEvent(" ");

    result.current(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });

  it("does nothing when nothing is selected", () => {
    const ref = makeTreeRef(null);
    const { result } = renderHook(() => useQuickLookHotkey(ref));
    const { event, preventDefault } = makeKeyEvent(" ");

    result.current(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });

  // ── F1: never hijack Space while typing in a text field / rename input ──

  it.each([
    { tagName: "INPUT", isContentEditable: false, label: "an <input>" },
    { tagName: "TEXTAREA", isContentEditable: false, label: "a <textarea>" },
    { tagName: "DIV", isContentEditable: true, label: "a contenteditable" },
  ])(
    "ignores Space typed inside $label (no open, no preventDefault)",
    ({ tagName, isContentEditable }) => {
      const ref = makeTreeRef({ id: "/ws/photo.png", isFolder: false });
      const { result } = renderHook(() => useQuickLookHotkey(ref));
      const { event, preventDefault } = makeKeyEvent(" ", {
        target: { tagName, isContentEditable },
      });

      result.current(event);

      expect(preventDefault).not.toHaveBeenCalled();
      expect(useQuickLookStore.getState().isOpen).toBe(false);
    },
  );

  // ── F2: only UNmodified Space triggers Quick Look ──

  it.each([
    { mod: "shiftKey" as const },
    { mod: "ctrlKey" as const },
    { mod: "metaKey" as const },
    { mod: "altKey" as const },
  ])("ignores modified Space ($mod)", ({ mod }) => {
    const ref = makeTreeRef({ id: "/ws/photo.png", isFolder: false });
    const { result } = renderHook(() => useQuickLookHotkey(ref));
    const { event, preventDefault } = makeKeyEvent(" ", { [mod]: true });

    result.current(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });

  it("does nothing when the tree ref is not attached", () => {
    const ref: RefObject<TreeApi<FileNode> | null> = { current: null };
    const { result } = renderHook(() => useQuickLookHotkey(ref));
    const { event, preventDefault } = makeKeyEvent(" ");

    result.current(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(useQuickLookStore.getState().isOpen).toBe(false);
  });
});
