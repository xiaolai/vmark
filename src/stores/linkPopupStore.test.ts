// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { useLinkPopupStore } from "./linkPopupStore";

const rect = { top: 0, left: 0, bottom: 10, right: 10 };

describe("linkPopupStore", () => {
  beforeEach(() => {
    useLinkPopupStore.getState().closePopup();
  });

  it("opens with href and position range", () => {
    useLinkPopupStore.getState().openPopup({
      href: "https://example.com",
      linkFrom: 10,
      linkTo: 20,
      anchorRect: rect,
    });

    const state = useLinkPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.href).toBe("https://example.com");
    expect(state.linkFrom).toBe(10);
    expect(state.linkTo).toBe(20);
    expect(state.anchorRect).toEqual(rect);
  });

  it("updates href", () => {
    useLinkPopupStore.getState().openPopup({
      href: "https://old.com",
      linkFrom: 0,
      linkTo: 10,
      anchorRect: rect,
    });
    useLinkPopupStore.getState().setHref("https://new.com");

    expect(useLinkPopupStore.getState().href).toBe("https://new.com");
  });

  it("closes and resets state", () => {
    useLinkPopupStore.getState().openPopup({
      href: "https://example.com",
      linkFrom: 10,
      linkTo: 20,
      anchorRect: rect,
    });
    useLinkPopupStore.getState().closePopup();

    const state = useLinkPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.href).toBe("");
    expect(state.linkFrom).toBe(0);
    expect(state.linkTo).toBe(0);
    expect(state.anchorRect).toBeNull();
  });

  it("handles bookmark links", () => {
    useLinkPopupStore.getState().openPopup({
      href: "#section-id",
      linkFrom: 5,
      linkTo: 15,
      anchorRect: rect,
    });

    const state = useLinkPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.href).toBe("#section-id");
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("linkPopupStore — T09 revert contract pins", () => {
  beforeEach(() => {
    useLinkPopupStore.getState().closePopup();
  });

  const initialData = {
    isOpen: false,
    href: "",
    linkFrom: 0,
    linkTo: 0,
    anchorRect: null,
  };

  function dataOf(s: ReturnType<typeof useLinkPopupStore.getState>) {
    const { isOpen, href, linkFrom, linkTo, anchorRect } = s;
    return { isOpen, href, linkFrom, linkTo, anchorRect };
  }

  it("no leak across sessions: open A → setHref → close → open B shows only B", () => {
    useLinkPopupStore.getState().openPopup({
      href: "https://a.com",
      linkFrom: 1,
      linkTo: 2,
      anchorRect: rect,
    });
    useLinkPopupStore.getState().setHref("https://a-edited.com");
    useLinkPopupStore.getState().closePopup();

    const rectB = { top: 5, left: 5, bottom: 15, right: 15 };
    useLinkPopupStore.getState().openPopup({
      href: "https://b.com",
      linkFrom: 30,
      linkTo: 40,
      anchorRect: rectB,
    });

    expect(dataOf(useLinkPopupStore.getState())).toEqual({
      isOpen: true,
      href: "https://b.com",
      linkFrom: 30,
      linkTo: 40,
      anchorRect: rectB,
    });
  });

  it("setLinkRange remaps only the range, keeping href and anchor (WI-1 wiring)", () => {
    useLinkPopupStore.getState().openPopup({
      href: "https://example.com",
      linkFrom: 10,
      linkTo: 20,
      anchorRect: rect,
    });
    useLinkPopupStore.getState().setLinkRange(30, 44);

    const state = useLinkPopupStore.getState();
    expect(state.linkFrom).toBe(30);
    expect(state.linkTo).toBe(44);
    expect(state.href).toBe("https://example.com");
    expect(state.anchorRect).toEqual(rect);
    expect(state.isOpen).toBe(true);
  });

  it("setHref while closed still mutates (pinned legacy behavior: setters are unguarded)", () => {
    useLinkPopupStore.getState().setHref("https://while-closed.com");
    const state = useLinkPopupStore.getState();
    expect(state.href).toBe("https://while-closed.com");
    expect(state.isOpen).toBe(false);
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useLinkPopupStore.getState().openPopup({
        href: `https://x${i}.com`,
        linkFrom: i,
        linkTo: i + 1,
        anchorRect: rect,
      });
      useLinkPopupStore.getState().closePopup();
    }
    expect(dataOf(useLinkPopupStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useLinkPopupStore.getState().openPopup({
        href: "https://mutated.com",
        linkFrom: 3,
        linkTo: 9,
        anchorRect: rect,
      });
      expect(dataOf(useLinkPopupStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useLinkPopupStore.getState().openPopup({
        href: "https://open.com",
        linkFrom: 3,
        linkTo: 9,
        anchorRect: rect,
      });
      useLinkPopupStore.setState(useLinkPopupStore.getInitialState());
      expect(dataOf(useLinkPopupStore.getState())).toEqual(initialData);
    });
  });
});
