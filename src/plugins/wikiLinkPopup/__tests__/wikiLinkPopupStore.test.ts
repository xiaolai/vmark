// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";

const rect = { top: 1, left: 2, bottom: 3, right: 4 };

describe("wikiLinkPopupStore", () => {
  beforeEach(() => {
    useWikiLinkPopupStore.getState().closePopup();
  });

  it("opens with target and position", () => {
    useWikiLinkPopupStore.getState().openPopup(rect, "Page", 12);
    const state = useWikiLinkPopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.target).toBe("Page");
    expect(state.nodePos).toBe(12);
    expect(state.anchorRect).toEqual(rect);
  });

  it("updates target", () => {
    useWikiLinkPopupStore.getState().openPopup(rect, "A", 1);
    useWikiLinkPopupStore.getState().updateTarget("C");
    const state = useWikiLinkPopupStore.getState();
    expect(state.target).toBe("C");
  });

  it("closes and resets state", () => {
    useWikiLinkPopupStore.getState().openPopup(rect, "A", 1);
    useWikiLinkPopupStore.getState().closePopup();
    const state = useWikiLinkPopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.target).toBe("");
    expect(state.nodePos).toBeNull();
    expect(state.anchorRect).toBeNull();
  });
});
