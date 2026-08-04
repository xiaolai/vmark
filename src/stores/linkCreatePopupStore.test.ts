import { beforeEach, describe, expect, it } from "vitest";
import { useLinkCreatePopupStore } from "./linkCreatePopupStore";

const rect = { top: 100, left: 200, bottom: 120, right: 300 };

describe("linkCreatePopupStore", () => {
  beforeEach(() => {
    useLinkCreatePopupStore.getState().closePopup();
  });

  it("opens popup with text and range", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "example",
      rangeFrom: 10,
      rangeTo: 17,
      anchorRect: rect,
      showTextInput: true,
    });

    const state = useLinkCreatePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.text).toBe("example");
    expect(state.url).toBe("");
    expect(state.rangeFrom).toBe(10);
    expect(state.rangeTo).toBe(17);
    expect(state.anchorRect).toEqual(rect);
    expect(state.showTextInput).toBe(true);
  });

  it("opens popup without text input when selection exists", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "selected text",
      rangeFrom: 0,
      rangeTo: 13,
      anchorRect: rect,
      showTextInput: false,
    });

    const state = useLinkCreatePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.text).toBe("selected text");
    expect(state.showTextInput).toBe(false);
  });

  it("closes popup and resets state", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "test",
      rangeFrom: 0,
      rangeTo: 4,
      anchorRect: rect,
      showTextInput: true,
    });
    useLinkCreatePopupStore.getState().closePopup();

    const state = useLinkCreatePopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.text).toBe("");
    expect(state.url).toBe("");
    expect(state.rangeFrom).toBe(0);
    expect(state.rangeTo).toBe(0);
    expect(state.anchorRect).toBeNull();
    expect(state.showTextInput).toBe(true);
  });

  it("updates text field", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "original",
      rangeFrom: 0,
      rangeTo: 8,
      anchorRect: rect,
      showTextInput: true,
    });
    useLinkCreatePopupStore.getState().setText("modified");

    expect(useLinkCreatePopupStore.getState().text).toBe("modified");
  });

  it("updates url field", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "link",
      rangeFrom: 0,
      rangeTo: 4,
      anchorRect: rect,
      showTextInput: true,
    });
    useLinkCreatePopupStore.getState().setUrl("https://example.com");

    expect(useLinkCreatePopupStore.getState().url).toBe("https://example.com");
  });

  it("resets url when reopening popup", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "first",
      rangeFrom: 0,
      rangeTo: 5,
      anchorRect: rect,
      showTextInput: true,
    });
    useLinkCreatePopupStore.getState().setUrl("https://first.com");

    // Reopen popup - url should reset
    useLinkCreatePopupStore.getState().openPopup({
      text: "second",
      rangeFrom: 10,
      rangeTo: 16,
      anchorRect: rect,
      showTextInput: true,
    });

    const state = useLinkCreatePopupStore.getState();
    expect(state.text).toBe("second");
    expect(state.url).toBe("");
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("linkCreatePopupStore — T09 revert contract pins", () => {
  beforeEach(() => {
    useLinkCreatePopupStore.getState().closePopup();
  });

  const initialData = {
    isOpen: false,
    text: "",
    url: "",
    rangeFrom: 0,
    rangeTo: 0,
    anchorRect: null,
    showTextInput: true,
  };

  function dataOf(s: ReturnType<typeof useLinkCreatePopupStore.getState>) {
    const { isOpen, text, url, rangeFrom, rangeTo, anchorRect, showTextInput } = s;
    return { isOpen, text, url, rangeFrom, rangeTo, anchorRect, showTextInput };
  }

  it("no leak across sessions: open A → setText/setUrl → close → open B shows only B", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "a",
      rangeFrom: 1,
      rangeTo: 2,
      anchorRect: rect,
      showTextInput: false,
    });
    useLinkCreatePopupStore.getState().setText("a-edited");
    useLinkCreatePopupStore.getState().setUrl("https://a.com");
    useLinkCreatePopupStore.getState().closePopup();

    useLinkCreatePopupStore.getState().openPopup({
      text: "b",
      rangeFrom: 10,
      rangeTo: 20,
      anchorRect: rect,
      showTextInput: true,
    });

    expect(dataOf(useLinkCreatePopupStore.getState())).toEqual({
      isOpen: true,
      text: "b",
      url: "",
      rangeFrom: 10,
      rangeTo: 20,
      anchorRect: rect,
      showTextInput: true,
    });
  });

  it("setText/setUrl while closed still mutate (pinned legacy behavior: setters are unguarded)", () => {
    useLinkCreatePopupStore.getState().setText("closed text");
    useLinkCreatePopupStore.getState().setUrl("https://closed.com");
    const state = useLinkCreatePopupStore.getState();
    expect(state.text).toBe("closed text");
    expect(state.url).toBe("https://closed.com");
    expect(state.isOpen).toBe(false);
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useLinkCreatePopupStore.getState().openPopup({
        text: `t${i}`,
        rangeFrom: i,
        rangeTo: i + 1,
        anchorRect: rect,
        showTextInput: i % 2 === 0,
      });
      useLinkCreatePopupStore.getState().closePopup();
    }
    expect(dataOf(useLinkCreatePopupStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useLinkCreatePopupStore.getState().openPopup({
        text: "m",
        rangeFrom: 1,
        rangeTo: 2,
        anchorRect: rect,
        showTextInput: false,
      });
      expect(dataOf(useLinkCreatePopupStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useLinkCreatePopupStore.getState().openPopup({
        text: "m",
        rangeFrom: 1,
        rangeTo: 2,
        anchorRect: rect,
        showTextInput: false,
      });
      useLinkCreatePopupStore.setState(useLinkCreatePopupStore.getInitialState());
      expect(dataOf(useLinkCreatePopupStore.getState())).toEqual(initialData);
    });
  });
});
