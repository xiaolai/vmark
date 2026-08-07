// @vitest-environment node
/**
 * Tests for linkCreatePopup — store behavior and extension structure.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { linkCreatePopupExtension } from "../tiptap";

describe("linkCreatePopupStore", () => {
  beforeEach(() => {
    useLinkCreatePopupStore.getState().closePopup();
  });

  it("starts closed with default state", () => {
    const state = useLinkCreatePopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.text).toBe("");
    expect(state.url).toBe("");
    expect(state.rangeFrom).toBe(0);
    expect(state.rangeTo).toBe(0);
    expect(state.anchorRect).toBeNull();
    expect(state.showTextInput).toBe(true);
  });

  it("opens popup with provided data", () => {
    const anchorRect = { top: 100, left: 200, bottom: 120, right: 300 };
    useLinkCreatePopupStore.getState().openPopup({
      text: "hello",
      rangeFrom: 5,
      rangeTo: 10,
      anchorRect,
      showTextInput: true,
    });

    const state = useLinkCreatePopupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.text).toBe("hello");
    expect(state.url).toBe("");
    expect(state.rangeFrom).toBe(5);
    expect(state.rangeTo).toBe(10);
    expect(state.anchorRect).toEqual(anchorRect);
    expect(state.showTextInput).toBe(true);
  });

  it("opens popup without text input when showTextInput is false", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "selected",
      rangeFrom: 0,
      rangeTo: 8,
      anchorRect: { top: 0, left: 0, bottom: 20, right: 100 },
      showTextInput: false,
    });

    const state = useLinkCreatePopupStore.getState();
    expect(state.showTextInput).toBe(false);
    expect(state.text).toBe("selected");
  });

  it("resets URL to empty on open", () => {
    useLinkCreatePopupStore.getState().setUrl("https://old.com");
    useLinkCreatePopupStore.getState().openPopup({
      text: "",
      rangeFrom: 0,
      rangeTo: 0,
      anchorRect: { top: 0, left: 0, bottom: 20, right: 100 },
      showTextInput: true,
    });

    expect(useLinkCreatePopupStore.getState().url).toBe("");
  });

  it("updates text via setText", () => {
    useLinkCreatePopupStore.getState().setText("new text");
    expect(useLinkCreatePopupStore.getState().text).toBe("new text");
  });

  it("updates url via setUrl", () => {
    useLinkCreatePopupStore.getState().setUrl("https://example.com");
    expect(useLinkCreatePopupStore.getState().url).toBe("https://example.com");
  });

  it("resets all state on closePopup", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "test",
      rangeFrom: 5,
      rangeTo: 10,
      anchorRect: { top: 100, left: 200, bottom: 120, right: 300 },
      showTextInput: true,
    });
    useLinkCreatePopupStore.getState().setUrl("https://example.com");

    useLinkCreatePopupStore.getState().closePopup();

    const state = useLinkCreatePopupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.text).toBe("");
    expect(state.url).toBe("");
    expect(state.rangeFrom).toBe(0);
    expect(state.rangeTo).toBe(0);
    expect(state.anchorRect).toBeNull();
  });
});

describe("linkCreatePopupExtension", () => {
  it("has the correct name", () => {
    expect(linkCreatePopupExtension.name).toBe("linkCreatePopup");
  });

  it("is an Extension type", () => {
    expect(linkCreatePopupExtension.type).toBe("extension");
  });
});
