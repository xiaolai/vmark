// #1714 — dropping a file onto the window crashed the whole view with
// "Cannot have two HTML5 backends at the same time."
//
// react-arborist's Tree used to bring its own DndProvider per mount. That
// provider's window-global manager is discarded when its last provider
// unmounts, even while the manager's HTML5 backend is still set up. A pending
// NATIVE-item drag (file, link, text) keeps it set up: the backend registers a
// synthetic source for it that only the DOM `drop` or final `dragleave` removes,
// and Tauri's drag-drop handler can intercept both. The remounted Tree then
// built a SECOND backend: react-dnd threw during commit.
//
// Each case below leaves a native drag open in the backend (the webview never
// sees it end) and remounts the Tree the way the app does.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  useWorkspaceInstancesStore,
  type WindowWorkspaceState,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import type { FileNode } from "./types";

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

interface TreeState {
  tree: FileNode[];
  isLoading: boolean;
}

const treeState: TreeState = { tree: [], isLoading: false };

vi.mock("./useFileTree", () => ({
  useFileTree: () => ({
    tree: treeState.tree,
    isLoading: treeState.isLoading,
    error: null,
    refresh: vi.fn(),
  }),
}));

import { FileExplorer } from "./FileExplorer";

const LOADED: FileNode[] = [
  { id: "/ws/需求文档.md", name: "需求文档", isFolder: false },
  { id: "/ws/notes.md", name: "notes", isFolder: false },
];

function setTree(next: TreeState): void {
  treeState.tree = next.tree;
  treeState.isLoading = next.isLoading;
}

/** An OS file drag entering the webview — the half of the gesture it does see. */
function nativeFileDragEnter(): void {
  const event = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files: [], items: [], getData: () => "", setData: () => {} },
  });
  document.body.dispatchEvent(event);
}

function backendSetUp(): boolean {
  return Boolean((window as unknown as { __isReactDndBackendSetUp?: boolean }).__isReactDndBackendSetUp);
}

function activateRailInstance(id: string): void {
  useWorkspaceInstancesStore.setState({
    instances: { [id]: { workspaceInstanceId: id } as WorkspaceInstanceRecord },
    windows: { main: { activeWorkspaceInstanceId: id } as WindowWorkspaceState },
  });
}

describe("FileExplorer — native file drop followed by a tree remount (#1714)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ isWorkspaceMode: true, rootPath: "/ws" });
    setTree({ tree: LOADED, isLoading: false });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState((s) => ({ general: { ...s.general, workspaceRailMode: false } }));
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    // Unmounting the explorer always releases its backend, stuck drag or not.
    expect(backendSetUp()).toBe(false);
  });

  it("survives the tree reloading while the file drag is still open", () => {
    const { rerender } = render(<FileExplorer currentFilePath={null} />);
    expect(screen.getByRole("tree")).toBeTruthy();

    act(() => nativeFileDragEnter());

    // The drop opens the dropped file's workspace: the listing empties while
    // the new root loads (Tree unmounts), then comes back (Tree remounts).
    useWorkspaceStore.setState({ rootPath: "/other" });
    setTree({ tree: [], isLoading: true });
    rerender(<FileExplorer currentFilePath={null} />);
    expect(screen.queryByRole("tree")).toBeNull();

    setTree({ tree: LOADED, isLoading: false });
    expect(() => rerender(<FileExplorer currentFilePath={null} />)).not.toThrow();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(backendSetUp()).toBe(true);
  });

  it("survives the whole explorer unmounting and remounting (sidebar toggle, view switch)", () => {
    const first = render(<FileExplorer currentFilePath={null} />);
    act(() => nativeFileDragEnter());
    first.unmount();

    expect(() => render(<FileExplorer currentFilePath={null} />)).not.toThrow();
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("survives rail workspace switches remounting the mounted Tree under a new key", () => {
    useSettingsStore.setState((s) => ({ general: { ...s.general, workspaceRailMode: true } }));
    activateRailInstance("ws-a");
    const { rerender } = render(<FileExplorer currentFilePath={null} />);
    act(() => nativeFileDragEnter());

    let previousTree = screen.getByRole("tree");
    for (const id of ["ws-b", "ws-c"]) {
      act(() => activateRailInstance(id));
      expect(() => rerender(<FileExplorer currentFilePath={null} />)).not.toThrow();
      const tree = screen.getByRole("tree");
      expect(tree).not.toBe(previousTree);
      previousTree = tree;
    }
  });

  it("survives repeated drops, each followed by a reload", () => {
    const { rerender } = render(<FileExplorer currentFilePath={null} />);
    for (let i = 0; i < 3; i++) {
      act(() => nativeFileDragEnter());

      setTree({ tree: [], isLoading: true });
      rerender(<FileExplorer currentFilePath={null} />);
      setTree({ tree: LOADED, isLoading: false });
      expect(() => rerender(<FileExplorer currentFilePath={null} />)).not.toThrow();
    }
    expect(screen.getByRole("tree")).toBeTruthy();
  });
});
