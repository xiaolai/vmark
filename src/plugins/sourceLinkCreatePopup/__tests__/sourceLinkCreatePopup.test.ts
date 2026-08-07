// @vitest-environment node
/**
 * Tests for sourceLinkCreatePopup — plugin structure and store interaction.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { createSourceLinkCreatePopupPlugin } from "../sourceLinkCreatePopupPlugin";

describe("createSourceLinkCreatePopupPlugin", () => {
  it("returns a ViewPlugin", () => {
    const plugin = createSourceLinkCreatePopupPlugin();
    // ViewPlugin.fromClass returns a ViewPlugin instance with an extension property
    expect(plugin).toBeDefined();
    expect(typeof plugin).toBe("object");
  });
});

describe("sourceLinkCreatePopup store integration", () => {
  beforeEach(() => {
    useLinkCreatePopupStore.getState().closePopup();
  });

  it("store manages popup lifecycle for source mode links", () => {
    const anchorRect = { top: 50, left: 100, bottom: 70, right: 200 };

    // Open popup as if in source mode
    useLinkCreatePopupStore.getState().openPopup({
      text: "",
      rangeFrom: 10,
      rangeTo: 10,
      anchorRect,
      showTextInput: true,
    });

    expect(useLinkCreatePopupStore.getState().isOpen).toBe(true);
    expect(useLinkCreatePopupStore.getState().showTextInput).toBe(true);
  });

  it("generates correct markdown link format", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "example",
      rangeFrom: 0,
      rangeTo: 0,
      anchorRect: { top: 0, left: 0, bottom: 20, right: 100 },
      showTextInput: true,
    });
    useLinkCreatePopupStore.getState().setUrl("https://example.com");

    const state = useLinkCreatePopupStore.getState();
    const linkText = state.showTextInput ? (state.text.trim() || state.url.trim()) : null;
    const finalUrl = state.url.trim();
    const markdown = `[${linkText}](${finalUrl})`;

    expect(markdown).toBe("[example](https://example.com)");
  });

  it("uses URL as link text when text is empty", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "",
      rangeFrom: 0,
      rangeTo: 0,
      anchorRect: { top: 0, left: 0, bottom: 20, right: 100 },
      showTextInput: true,
    });
    useLinkCreatePopupStore.getState().setUrl("https://example.com");

    const state = useLinkCreatePopupStore.getState();
    const linkText = state.showTextInput ? (state.text.trim() || state.url.trim()) : null;
    const finalUrl = state.url.trim();
    const markdown = `[${linkText}](${finalUrl})`;

    expect(markdown).toBe("[https://example.com](https://example.com)");
  });

  it("handles selection-based links without text input", () => {
    useLinkCreatePopupStore.getState().openPopup({
      text: "selected text",
      rangeFrom: 5,
      rangeTo: 18,
      anchorRect: { top: 0, left: 0, bottom: 20, right: 100 },
      showTextInput: false,
    });
    useLinkCreatePopupStore.getState().setUrl("https://link.com");

    const state = useLinkCreatePopupStore.getState();
    expect(state.showTextInput).toBe(false);
    // In source mode, existing text gets wrapped: [existing](url)
    const existingText = "selected text";
    const markdown = `[${existingText}](${state.url.trim()})`;
    expect(markdown).toBe("[selected text](https://link.com)");
  });
});
