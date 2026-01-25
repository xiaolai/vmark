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
