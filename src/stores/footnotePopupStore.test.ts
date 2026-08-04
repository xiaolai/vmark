import { beforeEach, describe, expect, it } from "vitest";
import { useFootnotePopupStore } from "./footnotePopupStore";
import { createMockRect } from "@/test/popupTestUtils";

describe("footnotePopupStore", () => {
  beforeEach(() => {
    useFootnotePopupStore.getState().closePopup();
  });

  const mockRect = createMockRect({ top: 100, left: 50, bottom: 120, right: 200 });

  it("opens with label and content", () => {
    useFootnotePopupStore.getState().openPopup(
      "1",
      "Footnote content here",
      mockRect,
      500,
      10
    );

    const state = useFootnotePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.label).toBe("1");
    expect(state.content).toBe("Footnote content here");
    expect(state.definitionPos).toBe(500);
    expect(state.referencePos).toBe(10);
    expect(state.autoFocus).toBe(false);
  });

  it("opens with autoFocus for new footnotes", () => {
    useFootnotePopupStore.getState().openPopup(
      "new",
      "",
      mockRect,
      600,
      20,
      true
    );

    const state = useFootnotePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.autoFocus).toBe(true);
  });

  it("updates content", () => {
    useFootnotePopupStore.getState().openPopup("1", "Old content", mockRect, 500, 10);
    useFootnotePopupStore.getState().setContent("New content");

    expect(useFootnotePopupStore.getState().content).toBe("New content");
  });

  it("handles null positions", () => {
    useFootnotePopupStore.getState().openPopup(
      "orphan",
      "Orphan footnote",
      mockRect,
      null,
      null
    );

    const state = useFootnotePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.definitionPos).toBeNull();
    expect(state.referencePos).toBeNull();
  });

  it("closes and resets state", () => {
    useFootnotePopupStore.getState().openPopup("1", "Content", mockRect, 500, 10, true);
    useFootnotePopupStore.getState().closePopup();

    const state = useFootnotePopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.label).toBe("");
    expect(state.content).toBe("");
    expect(state.anchorRect).toBeNull();
    expect(state.definitionPos).toBeNull();
    expect(state.referencePos).toBeNull();
    expect(state.autoFocus).toBe(false);
  });

  it("preserves anchor rect", () => {
    useFootnotePopupStore.getState().openPopup("1", "Test", mockRect, 100, 50);

    const state = useFootnotePopupStore.getState();
    expect(state.anchorRect).toBe(mockRect);
    expect(state.anchorRect?.top).toBe(100);
    expect(state.anchorRect?.left).toBe(50);
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("footnotePopupStore — T09 revert contract pins", () => {
  beforeEach(() => {
    useFootnotePopupStore.getState().closePopup();
  });

  const mockRect = createMockRect({ top: 100, left: 50, bottom: 120, right: 200 });
  const initialData = {
    isOpen: false,
    label: "",
    content: "",
    anchorRect: null,
    definitionPos: null,
    referencePos: null,
    autoFocus: false,
  };

  function dataOf(s: ReturnType<typeof useFootnotePopupStore.getState>) {
    const { isOpen, label, content, anchorRect, definitionPos, referencePos, autoFocus } = s;
    return { isOpen, label, content, anchorRect, definitionPos, referencePos, autoFocus };
  }

  it("no leak across sessions: open A → setContent → close → open B shows only B", () => {
    useFootnotePopupStore.getState().openPopup("a", "A content", mockRect, 100, 10, true);
    useFootnotePopupStore.getState().setContent("A edited");
    useFootnotePopupStore.getState().closePopup();

    useFootnotePopupStore.getState().openPopup("b", "B content", mockRect, 200, 20);

    expect(dataOf(useFootnotePopupStore.getState())).toEqual({
      isOpen: true,
      label: "b",
      content: "B content",
      anchorRect: mockRect,
      definitionPos: 200,
      referencePos: 20,
      autoFocus: false,
    });
  });

  it("setContent while closed still mutates (pinned legacy behavior: setters are unguarded)", () => {
    useFootnotePopupStore.getState().setContent("closed edit");
    const state = useFootnotePopupStore.getState();
    expect(state.content).toBe("closed edit");
    expect(state.isOpen).toBe(false);
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useFootnotePopupStore.getState().openPopup(`${i}`, `c${i}`, mockRect, i, i, i % 2 === 0);
      useFootnotePopupStore.getState().closePopup();
    }
    expect(dataOf(useFootnotePopupStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useFootnotePopupStore.getState().openPopup("m", "mutated", mockRect, 1, 2, true);
      expect(dataOf(useFootnotePopupStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useFootnotePopupStore.getState().openPopup("m", "open", mockRect, 1, 2, true);
      useFootnotePopupStore.setState(useFootnotePopupStore.getInitialState());
      expect(dataOf(useFootnotePopupStore.getState())).toEqual(initialData);
    });
  });
});
