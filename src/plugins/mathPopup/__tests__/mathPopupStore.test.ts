// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { useMathPopupStore } from "@/stores/mathPopupStore";

const rect = { top: 0, left: 0, bottom: 10, right: 10 };

describe("mathPopupStore", () => {
  beforeEach(() => {
    useMathPopupStore.getState().closePopup();
  });

  it("opens with latex and node position", () => {
    useMathPopupStore.getState().openPopup(rect, "x^2", 42);
    const state = useMathPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.latex).toBe("x^2");
    expect(state.nodePos).toBe(42);
    expect(state.anchorRect).toEqual(rect);
  });

  it("updates latex", () => {
    useMathPopupStore.getState().openPopup(rect, "x", 1);
    useMathPopupStore.getState().updateLatex("y");
    expect(useMathPopupStore.getState().latex).toBe("y");
  });

  it("closes and resets state", () => {
    useMathPopupStore.getState().openPopup(rect, "x", 1);
    useMathPopupStore.getState().closePopup();
    const state = useMathPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.latex).toBe("");
    expect(state.nodePos).toBeNull();
    expect(state.anchorRect).toBeNull();
  });
});
