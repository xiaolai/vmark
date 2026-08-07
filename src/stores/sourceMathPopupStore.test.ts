// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { useSourceMathPopupStore } from "./sourceMathPopupStore";

describe("sourceMathPopupStore", () => {
  beforeEach(() => {
    useSourceMathPopupStore.getState().closePopup();
  });

  it("opens popup with correct state", () => {
    const rect = { top: 10, left: 20, bottom: 30, right: 40 };
    useSourceMathPopupStore.getState().openPopup(rect, "x^2", 5, 10, false);

    const state = useSourceMathPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.anchorRect).toEqual(rect);
    expect(state.latex).toBe("x^2");
    expect(state.originalLatex).toBe("x^2");
    expect(state.mathFrom).toBe(5);
    expect(state.mathTo).toBe(10);
    expect(state.isBlock).toBe(false);
  });

  it("closes popup and resets state", () => {
    const rect = { top: 10, left: 20, bottom: 30, right: 40 };
    useSourceMathPopupStore.getState().openPopup(rect, "x^2", 5, 10, false);
    useSourceMathPopupStore.getState().closePopup();

    const state = useSourceMathPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.anchorRect).toBeNull();
    expect(state.latex).toBe("");
    expect(state.originalLatex).toBe("");
  });

  it("updates latex while keeping other state", () => {
    const rect = { top: 10, left: 20, bottom: 30, right: 40 };
    useSourceMathPopupStore.getState().openPopup(rect, "x^2", 5, 10, false);
    useSourceMathPopupStore.getState().updateLatex("x^3 + y");

    const state = useSourceMathPopupStore.getState();
    expect(state.latex).toBe("x^3 + y");
    expect(state.originalLatex).toBe("x^2");
    expect(state.isOpen).toBe(true);
  });

  it("sets isBlock flag for block math", () => {
    const rect = { top: 10, left: 20, bottom: 30, right: 40 };
    useSourceMathPopupStore.getState().openPopup(rect, "\\sum_{i=1}^n", 0, 20, true);

    expect(useSourceMathPopupStore.getState().isBlock).toBe(true);
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("sourceMathPopupStore — T09 revert contract pins", () => {
  beforeEach(() => {
    useSourceMathPopupStore.getState().closePopup();
  });

  const initialData = {
    isOpen: false,
    anchorRect: null,
    latex: "",
    originalLatex: "",
    mathFrom: 0,
    mathTo: 0,
    isBlock: false,
  };
  const rect = { top: 1, left: 2, bottom: 3, right: 4 };

  function dataOf(s: ReturnType<typeof useSourceMathPopupStore.getState>) {
    const { isOpen, anchorRect, latex, originalLatex, mathFrom, mathTo, isBlock } = s;
    return { isOpen, anchorRect, latex, originalLatex, mathFrom, mathTo, isBlock };
  }

  it("no leak across sessions: open A → updateLatex → close → open B shows only B", () => {
    useSourceMathPopupStore.getState().openPopup(rect, "a", 1, 2, false);
    useSourceMathPopupStore.getState().updateLatex("a-edited");
    useSourceMathPopupStore.getState().closePopup();

    useSourceMathPopupStore.getState().openPopup(rect, "b", 10, 20, true);

    expect(dataOf(useSourceMathPopupStore.getState())).toEqual({
      isOpen: true,
      anchorRect: rect,
      latex: "b",
      originalLatex: "b",
      mathFrom: 10,
      mathTo: 20,
      isBlock: true,
    });
  });

  it("updateLatex while closed still mutates (pinned legacy behavior: setters are unguarded)", () => {
    useSourceMathPopupStore.getState().updateLatex("closed edit");
    const state = useSourceMathPopupStore.getState();
    expect(state.latex).toBe("closed edit");
    expect(state.isOpen).toBe(false);
    expect(state.originalLatex).toBe("");
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useSourceMathPopupStore.getState().openPopup(rect, `l${i}`, i, i + 1, i % 2 === 0);
      useSourceMathPopupStore.getState().closePopup();
    }
    expect(dataOf(useSourceMathPopupStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useSourceMathPopupStore.getState().openPopup(rect, "mutated", 1, 2, true);
      expect(dataOf(useSourceMathPopupStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useSourceMathPopupStore.getState().openPopup(rect, "open", 1, 2, true);
      useSourceMathPopupStore.setState(useSourceMathPopupStore.getInitialState());
      expect(dataOf(useSourceMathPopupStore.getState())).toEqual(initialData);
    });
  });
});
