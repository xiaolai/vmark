// Audit F6 — the initial WYSIWYG content-search navigation was dropped when
// the visibility effect ran before deferred editor initialization. This suite
// pins the extracted helper: consume-and-jump semantics, preservation when the
// view isn't ready, and the FindBar pre-fill.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { consumeWysiwygPendingNav } from "./wysiwygPendingNav";
import {
  setPendingContentSearchNav,
  consumePendingContentSearchNav,
  clearPendingContentSearchNav,
} from "@/hooks/contentSearchNavigation";
import { useUIStore } from "@/stores/uiStore";

function makeView(paragraphs: string[]) {
  const schema = getSchema([StarterKit]);
  const doc = schema.nodes.doc.create(
    null,
    paragraphs.map((text) => schema.nodes.paragraph.create(null, schema.text(text))),
  );
  const view = {
    state: EditorState.create({ schema, doc }),
    dispatch: vi.fn((tr) => {
      view.state = view.state.apply(tr);
    }),
    focus: vi.fn(),
  };
  return view;
}

describe("consumeWysiwygPendingNav", () => {
  beforeEach(() => {
    clearPendingContentSearchNav("tab-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false and PRESERVES the pending nav when the view is not ready", () => {
    setPendingContentSearchNav("tab-1", 2, "beta");

    expect(consumeWysiwygPendingNav(null, "tab-1")).toBe(false);

    // Still pending — a later consumer (deferred init, mode switch) gets it.
    expect(consumePendingContentSearchNav("tab-1")).toBeDefined();
  });

  it("returns false when there is no pending nav or no tabId", () => {
    const view = makeView(["alpha"]);
    expect(consumeWysiwygPendingNav(view as never, "tab-1")).toBe(false);
    expect(consumeWysiwygPendingNav(view as never, undefined)).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.focus).not.toHaveBeenCalled();
  });

  it("selects the Nth textblock, focuses the view, and consumes the nav", () => {
    const view = makeView(["alpha", "beta", "gamma"]);
    setPendingContentSearchNav("tab-1", 2, "");

    expect(consumeWysiwygPendingNav(view as never, "tab-1")).toBe(true);

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    // Second paragraph starts at pos 7 ("alpha" para occupies 0..7); the
    // selection lands inside it.
    let secondParaPos = -1;
    let count = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.isTextblock) {
        count++;
        if (count === 2) secondParaPos = pos;
      }
      return true;
    });
    expect(view.state.selection.from).toBeGreaterThanOrEqual(secondParaPos);
    expect(view.state.selection.from).toBeLessThan(secondParaPos + 7);
    expect(view.focus).toHaveBeenCalled();
    expect(consumePendingContentSearchNav("tab-1")).toBeUndefined();
  });

  it("skips the selection dispatch (but still consumes) when the line is beyond the doc", () => {
    const view = makeView(["only one"]);
    setPendingContentSearchNav("tab-1", 42, "");

    expect(consumeWysiwygPendingNav(view as never, "tab-1")).toBe(true);

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
    expect(consumePendingContentSearchNav("tab-1")).toBeUndefined();
  });

  it("pre-fills the FindBar after a delay only when the nav has a query", () => {
    vi.useFakeTimers();
    const view = makeView(["alpha", "beta"]);

    setPendingContentSearchNav("tab-1", 1, "");
    consumeWysiwygPendingNav(view as never, "tab-1");
    vi.advanceTimersByTime(200);
    expect(useUIStore.getState().search.isOpen).toBe(false);

    setPendingContentSearchNav("tab-1", 2, "beta");
    consumeWysiwygPendingNav(view as never, "tab-1");
    vi.advanceTimersByTime(200);
    expect(useUIStore.getState().search.isOpen).toBe(true);
    expect(useUIStore.getState().search.query).toBe("beta");

    useUIStore.getState().searchClose();
  });
});
