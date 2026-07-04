/**
 * Tests for the shared link-create popup DOM builder.
 */

import { describe, it, expect, vi } from "vitest";
import { buildLinkCreateContent, type LinkCreateDomHandlers } from "./linkCreateDom";

function makeHandlers(): LinkCreateDomHandlers {
  return {
    onTextInput: vi.fn(),
    onUrlInput: vi.fn(),
    onInputKeydown: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("buildLinkCreateContent", () => {
  it("builds text + URL rows when showTextInput is true", () => {
    const container = document.createElement("div");
    const refs = buildLinkCreateContent(container, true, makeHandlers());

    expect(refs.textInput).not.toBeNull();
    expect(container.querySelector(".link-create-popup-text")).toBe(refs.textInput);
    expect(container.querySelector(".link-create-popup-url")).toBe(refs.urlInput);
    expect(container.querySelectorAll(".link-create-popup-row")).toHaveLength(2);
  });

  it("builds only the URL row when showTextInput is false", () => {
    const container = document.createElement("div");
    const refs = buildLinkCreateContent(container, false, makeHandlers());

    expect(refs.textInput).toBeNull();
    expect(container.querySelector(".link-create-popup-text")).toBeNull();
    expect(container.querySelectorAll(".link-create-popup-row")).toHaveLength(1);
  });

  it("clears previous content on rebuild", () => {
    const container = document.createElement("div");
    buildLinkCreateContent(container, true, makeHandlers());
    buildLinkCreateContent(container, false, makeHandlers());

    expect(container.querySelector(".link-create-popup-text")).toBeNull();
    expect(container.querySelectorAll(".link-create-popup-url")).toHaveLength(1);
  });

  it("has save and cancel buttons wired to handlers", () => {
    const container = document.createElement("div");
    const handlers = makeHandlers();
    buildLinkCreateContent(container, false, handlers);

    (container.querySelector(".link-create-popup-btn-save") as HTMLButtonElement).click();
    expect(handlers.onSave).toHaveBeenCalled();

    (container.querySelector(".link-create-popup-btn-cancel") as HTMLButtonElement).click();
    expect(handlers.onCancel).toHaveBeenCalled();
  });

  it("wires input and keydown handlers on both inputs", () => {
    const container = document.createElement("div");
    const handlers = makeHandlers();
    const refs = buildLinkCreateContent(container, true, handlers);

    refs.textInput!.dispatchEvent(new Event("input"));
    refs.urlInput.dispatchEvent(new Event("input"));
    expect(handlers.onTextInput).toHaveBeenCalledTimes(1);
    expect(handlers.onUrlInput).toHaveBeenCalledTimes(1);

    refs.urlInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(handlers.onInputKeydown).toHaveBeenCalled();
  });
});
