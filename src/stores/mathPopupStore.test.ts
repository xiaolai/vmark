import { beforeEach, describe, expect, it } from "vitest";
import { useMathPopupStore } from "./mathPopupStore";
import type { AnchorRect } from "@/utils/popupPosition";

describe("mathPopupStore", () => {
  beforeEach(() => {
    useMathPopupStore.setState({
      isOpen: false,
      anchorRect: null,
      latex: "",
      nodePos: null,
    });
  });

  const mockRect: AnchorRect = { top: 10, left: 20, bottom: 30, right: 40 };

  it("has the expected initial state", () => {
    const state = useMathPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.anchorRect).toBeNull();
    expect(state.latex).toBe("");
    expect(state.nodePos).toBeNull();
  });

  it("opens with rect, latex, and node position", () => {
    useMathPopupStore.getState().openPopup(mockRect, "x^2", 42);

    const state = useMathPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.anchorRect).toBe(mockRect);
    expect(state.latex).toBe("x^2");
    expect(state.nodePos).toBe(42);
  });

  it("closes and resets all state to initial values", () => {
    useMathPopupStore.getState().openPopup(mockRect, "x^2", 42);
    useMathPopupStore.getState().closePopup();

    const state = useMathPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.anchorRect).toBeNull();
    expect(state.latex).toBe("");
    expect(state.nodePos).toBeNull();
  });

  it("updateLatex changes only latex while popup is open", () => {
    useMathPopupStore.getState().openPopup(mockRect, "x^2", 42);
    useMathPopupStore.getState().updateLatex("\\frac{a}{b}");

    const state = useMathPopupStore.getState();
    expect(state.latex).toBe("\\frac{a}{b}");
    expect(state.isOpen).toBe(true);
    expect(state.anchorRect).toBe(mockRect);
    expect(state.nodePos).toBe(42);
  });

  it("updateLatex still mutates latex while popup is closed", () => {
    useMathPopupStore.getState().updateLatex("e^{i\\pi}");

    const state = useMathPopupStore.getState();
    expect(state.latex).toBe("e^{i\\pi}");
    expect(state.isOpen).toBe(false);
    expect(state.anchorRect).toBeNull();
    expect(state.nodePos).toBeNull();
  });

  it("openPopup called twice replaces all three fields", () => {
    useMathPopupStore.getState().openPopup(mockRect, "x^2", 42);

    const secondRect: AnchorRect = { top: 100, left: 200, bottom: 130, right: 240 };
    useMathPopupStore.getState().openPopup(secondRect, "y^3", 99);

    const state = useMathPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.anchorRect).toBe(secondRect);
    expect(state.latex).toBe("y^3");
    expect(state.nodePos).toBe(99);
  });
});
