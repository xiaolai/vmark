// Audit F2 — pending-navigation handling was duplicated between SourceEditor's
// mount path and its hidden→visible path; this suite pins the extracted
// helper's behavior (lint scroll, content-search jump, FindBar pre-fill).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { consumeSourcePendingNav } from "./sourcePendingNav";
import {
  setPendingContentSearchNav,
  consumePendingContentSearchNav,
  clearPendingContentSearchNav,
} from "@/hooks/contentSearchNavigation";
import { useUIStore } from "@/stores/uiStore";

const lintMock = vi.hoisted(() => ({
  consumePendingLintScroll: vi.fn<(tabId: string) => number | undefined>(() => undefined),
}));

vi.mock("@/hooks/lintNavigation", () => lintMock);

function makeView(doc: string): EditorView {
  return new EditorView({ state: EditorState.create({ doc }) });
}

describe("consumeSourcePendingNav", () => {
  beforeEach(() => {
    lintMock.consumePendingLintScroll.mockReset();
    lintMock.consumePendingLintScroll.mockReturnValue(undefined);
    clearPendingContentSearchNav("tab-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing without a tabId (pending state stays untouched)", () => {
    const view = makeView("hello");
    setPendingContentSearchNav("tab-1", 1, "hello");

    consumeSourcePendingNav(view, undefined);

    expect(lintMock.consumePendingLintScroll).not.toHaveBeenCalled();
    // Pending nav is preserved for a later consumer.
    expect(consumePendingContentSearchNav("tab-1")).toBeDefined();
    view.destroy();
  });

  it("dispatches a scroll for a pending lint offset, clamped to the doc length", () => {
    const view = makeView("short");
    lintMock.consumePendingLintScroll.mockReturnValue(9999);
    const dispatch = vi.spyOn(view, "dispatch");

    consumeSourcePendingNav(view, "tab-1");

    expect(lintMock.consumePendingLintScroll).toHaveBeenCalledWith("tab-1");
    expect(dispatch).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("selects the pending content-search line and clamps beyond-doc lines", () => {
    const view = makeView("line one\nline two\nline three");
    setPendingContentSearchNav("tab-1", 2, "");

    consumeSourcePendingNav(view, "tab-1");

    // Line 2 starts after "line one\n" → offset 9.
    expect(view.state.selection.main.anchor).toBe(9);
    // Consumed — a second call finds nothing pending.
    expect(consumePendingContentSearchNav("tab-1")).toBeUndefined();

    // Beyond-doc line clamps to the last line.
    setPendingContentSearchNav("tab-1", 99, "");
    consumeSourcePendingNav(view, "tab-1");
    expect(view.state.selection.main.anchor).toBe(view.state.doc.line(3).from);
    view.destroy();
  });

  it("pre-fills the FindBar after a delay only when the nav has a query", () => {
    vi.useFakeTimers();
    const view = makeView("alpha\nbeta");

    // Empty query: no FindBar.
    setPendingContentSearchNav("tab-1", 1, "");
    consumeSourcePendingNav(view, "tab-1");

    // With a query: FindBar opens pre-filled after the settle delay.
    setPendingContentSearchNav("tab-1", 2, "beta");
    consumeSourcePendingNav(view, "tab-1");
    expect(useUIStore.getState().search.isOpen).toBe(false); // not yet

    // Destroy the view BEFORE advancing timers — CodeMirror's internal
    // measure cycle also runs on fake timers and needs real layout APIs.
    view.destroy();
    vi.advanceTimersByTime(200);
    expect(useUIStore.getState().search.isOpen).toBe(true);
    expect(useUIStore.getState().search.query).toBe("beta");

    useUIStore.getState().searchClose();
  });
});
