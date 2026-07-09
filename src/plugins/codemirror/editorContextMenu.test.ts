// WI-3.1 / WI-3.3 — Source-mode contextmenu trigger: precedence guards,
// caret-move vs selection-preserve, table ownership re-check, reduced
// SplitPane snapshot, and clipboard-bridge view registration/cleanup.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildSourceSnapshot: vi.fn(() => ({ surface: "source" }) as never),
  getSourceTableInfo: vi.fn(() => null as unknown),
  setContextMenuSourceView: vi.fn(),
  clearContextMenuSourceView: vi.fn(),
}));

vi.mock("@/plugins/editorContextMenu/snapshot", () => ({
  buildSourceSnapshot: mocks.buildSourceSnapshot,
}));
vi.mock("@/plugins/sourceContextDetection/tableDetection", () => ({
  getSourceTableInfo: mocks.getSourceTableInfo,
}));
vi.mock("@/components/Editor/EditorContextMenu/clipboardBridge", () => ({
  setContextMenuSourceView: mocks.setContextMenuSourceView,
  clearContextMenuSourceView: mocks.clearContextMenuSourceView,
}));

import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  buildReducedSourceSnapshot,
  handleSourceContextMenu,
  reducedEditorContextMenuExtension,
} from "./editorContextMenu";
import { usePopupStore } from "@/stores/popupStore";
import { initialEditorContextMenu } from "@/stores/popupStore/slices";

function createView(doc = "hello world", selection?: { anchor: number; head?: number }): EditorView {
  const state = EditorState.create({
    doc,
    selection: selection ? EditorSelection.single(selection.anchor, selection.head ?? selection.anchor) : undefined,
  });
  const view = new EditorView({ state });
  return view;
}

function contextMenuEvent(): MouseEvent {
  return new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 50,
    clientY: 60,
  });
}

function stubPosAtCoords(view: EditorView, pos: number | null): void {
  Object.defineProperty(view, "posAtCoords", { value: () => pos });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePopupStore.setState({ editorContextMenu: initialEditorContextMenu });
});

describe("handleSourceContextMenu", () => {
  it("bails when a more specific menu already claimed the event", () => {
    const view = createView();
    stubPosAtCoords(view, 3);
    const event = contextMenuEvent();
    event.preventDefault();
    expect(handleSourceContextMenu(view, event, { reduced: false })).toBe(false);
    view.destroy();
  });

  it("bails when the click position cannot be resolved", () => {
    const view = createView();
    stubPosAtCoords(view, null);
    expect(handleSourceContextMenu(view, contextMenuEvent(), { reduced: false })).toBe(false);
    view.destroy();
  });

  it("moves the caret to the click position when outside the selection", () => {
    const view = createView("hello world", { anchor: 0 });
    stubPosAtCoords(view, 7);
    expect(handleSourceContextMenu(view, contextMenuEvent(), { reduced: false })).toBe(true);
    expect(view.state.selection.main.from).toBe(7);
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(true);
    view.destroy();
  });

  it("preserves a selection when the click lands inside it", () => {
    const view = createView("hello world", { anchor: 2, head: 9 });
    stubPosAtCoords(view, 5);
    handleSourceContextMenu(view, contextMenuEvent(), { reduced: false });
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(9);
    view.destroy();
  });

  it("defers to the table menu inside source tables (returns false, order-robust)", () => {
    mocks.getSourceTableInfo.mockReturnValueOnce({ table: true });
    const view = createView();
    stubPosAtCoords(view, 3);
    // false lets the event continue to the table handler even if this
    // handler were ever registered first (ADR-5 order-robustness).
    expect(handleSourceContextMenu(view, contextMenuEvent(), { reduced: false })).toBe(false);
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
    view.destroy();
  });

  it("preserves multi-cursor selections when clicking inside a non-main range", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "alpha beta gamma",
        extensions: [EditorState.allowMultipleSelections.of(true)],
      }),
    });
    // Two ranges: [0,5) and [6,10); main is the last one.
    view.dispatch({
      selection: EditorSelection.create(
        [EditorSelection.range(0, 5), EditorSelection.range(6, 10)],
        1
      ),
    });
    stubPosAtCoords(view, 2); // inside the FIRST (non-main) range
    handleSourceContextMenu(view, contextMenuEvent(), { reduced: false });
    expect(view.state.selection.ranges).toHaveLength(2);
    expect(view.state.selection.ranges[0].from).toBe(0);
    view.destroy();
  });

  it("registers the view as the clipboard-bridge source target", () => {
    const view = createView();
    stubPosAtCoords(view, 3);
    handleSourceContextMenu(view, contextMenuEvent(), { reduced: false });
    expect(mocks.setContextMenuSourceView).toHaveBeenCalledWith(view);
    view.destroy();
  });

  it("reduced mode skips markdown context and emits a restricted snapshot", () => {
    const view = createView("{}", { anchor: 0 });
    stubPosAtCoords(view, 1);
    handleSourceContextMenu(view, contextMenuEvent(), { reduced: true });
    expect(mocks.buildSourceSnapshot).not.toHaveBeenCalled();
    expect(mocks.getSourceTableInfo).not.toHaveBeenCalled();
    const snap = usePopupStore.getState().editorContextMenu.snapshot;
    expect(snap?.formatPolicy).toEqual({ paragraphFormatting: false, insertBlockActions: false });
    view.destroy();
  });
});

describe("buildReducedSourceSnapshot", () => {
  it("reflects the selection emptiness of the pane view", () => {
    const view = createView("hello", { anchor: 1, head: 4 });
    expect(buildReducedSourceSnapshot(view).selectionEmpty).toBe(false);
    view.destroy();

    const collapsed = createView("hello", { anchor: 2 });
    expect(buildReducedSourceSnapshot(collapsed).selectionEmpty).toBe(true);
    collapsed.destroy();
  });
});

describe("view plugin lifecycle", () => {
  it("clears the clipboard-bridge registration on destroy (#283 class)", () => {
    const state = EditorState.create({
      doc: "x",
      extensions: [reducedEditorContextMenuExtension],
    });
    const view = new EditorView({ state });
    view.destroy();
    expect(mocks.clearContextMenuSourceView).toHaveBeenCalledWith(view);
  });
});
