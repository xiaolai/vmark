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
