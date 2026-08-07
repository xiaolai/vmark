// @vitest-environment node
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

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("mathPopupStore — T09 revert contract pins", () => {
  beforeEach(() => {
    useMathPopupStore.getState().closePopup();
  });

  const initialData = { isOpen: false, anchorRect: null, latex: "", nodePos: null };
  const rect: AnchorRect = { top: 1, left: 2, bottom: 3, right: 4 };

  function dataOf(s: ReturnType<typeof useMathPopupStore.getState>) {
    const { isOpen, anchorRect, latex, nodePos } = s;
    return { isOpen, anchorRect, latex, nodePos };
  }

  it("no leak across sessions: open A → updateLatex → close → open B shows only B", () => {
    useMathPopupStore.getState().openPopup(rect, "a^2", 1);
    useMathPopupStore.getState().updateLatex("a^2 + b");
    useMathPopupStore.getState().closePopup();

    const rectB: AnchorRect = { top: 9, left: 9, bottom: 19, right: 19 };
    useMathPopupStore.getState().openPopup(rectB, "b^2", 7);

    expect(dataOf(useMathPopupStore.getState())).toEqual({
      isOpen: true,
      anchorRect: rectB,
      latex: "b^2",
      nodePos: 7,
    });
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useMathPopupStore.getState().openPopup(rect, `x^${i}`, i);
      useMathPopupStore.getState().closePopup();
    }
    expect(dataOf(useMathPopupStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useMathPopupStore.getState().openPopup(rect, "mutated", 5);
      expect(dataOf(useMathPopupStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useMathPopupStore.getState().openPopup(rect, "open", 5);
      useMathPopupStore.setState(useMathPopupStore.getInitialState());
      expect(dataOf(useMathPopupStore.getState())).toEqual(initialData);
    });
  });
});
