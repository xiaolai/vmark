/**
 * Media Popup DOM Tests
 *
 * Tests for DOM construction helpers and keyboard navigation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

vi.mock("@/utils/popupComponents", () => ({
  popupIcons: {
    folder: '<svg data-icon="folder"></svg>',
    copy: '<svg data-icon="copy"></svg>',
    delete: '<svg data-icon="delete"></svg>',
    blockImage: '<svg data-icon="blockImage"></svg>',
    inlineImage: '<svg data-icon="inlineImage"></svg>',
  },
  buildPopupIconButton: vi.fn(({ icon, title, onClick, variant, className }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = `<svg data-icon="${icon}"></svg>`;
    btn.className = [
      "popup-icon-btn",
      variant && variant !== "default" ? `popup-icon-btn--${variant}` : "",
      className || "",
    ]
      .filter(Boolean)
      .join(" ");
    btn.addEventListener("click", onClick);
    return btn;
  }),
  buildPopupInput: vi.fn(({ placeholder, monospace, fullWidth, className, onInput, onKeydown }) => {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder || "";
    const classes = ["popup-input"];
    if (monospace) classes.push("popup-input--mono");
    if (fullWidth) classes.push("popup-input--full");
    if (className) classes.push(className);
    input.className = classes.join(" ");
    if (onInput) input.addEventListener("input", () => onInput(input.value));
    if (onKeydown) input.addEventListener("keydown", onKeydown);
    return input;
  }),
}));

import { createMediaPopupDom, installMediaPopupKeyboardNavigation, updateMediaPopupToggleButton } from "../mediaPopupDom";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { popupIcons } from "@/utils/popupComponents";

describe("createMediaPopupDom", () => {
  const handlers = {
    onBrowse: vi.fn(),
    onCopy: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
    onInputKeydown: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates container with media-popup class", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.container.className).toBe("media-popup");
    expect(dom.container.style.display).toBe("none");
  });

  it("creates src input with correct placeholder", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.srcInput).toBeInstanceOf(HTMLInputElement);
    expect(dom.srcInput.placeholder).toContain("source");
  });

  it("creates title input with correct placeholder", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.titleInput).toBeInstanceOf(HTMLInputElement);
    expect(dom.titleInput.placeholder).toContain("Title");
  });

  it("creates poster input with correct placeholder", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.posterInput).toBeInstanceOf(HTMLInputElement);
    expect(dom.posterInput.placeholder).toContain("Poster");
  });

  it("poster row is a separate element for visibility control", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.posterRow).toBeInstanceOf(HTMLElement);
    expect(dom.container.contains(dom.posterRow)).toBe(true);
  });

  it("has browse button with folder icon", () => {
    const dom = createMediaPopupDom(handlers);
    const browseBtn = dom.container.querySelector('button[title="Browse local file"]');
    expect(browseBtn).not.toBeNull();
  });

  it("has copy button", () => {
    const dom = createMediaPopupDom(handlers);
    const copyBtn = dom.container.querySelector('button[title="Copy path"]');
    expect(copyBtn).not.toBeNull();
  });

  it("has delete button with danger variant", () => {
    const dom = createMediaPopupDom(handlers);
    const deleteBtn = dom.container.querySelector('button[title="Remove media"]');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn!.classList.contains("popup-icon-btn--danger")).toBe(true);
  });

  it("wires browse button click to handler", () => {
    const dom = createMediaPopupDom(handlers);
    const browseBtn = dom.container.querySelector('button[title="Browse local file"]') as HTMLElement;
    browseBtn.click();
    expect(handlers.onBrowse).toHaveBeenCalledOnce();
  });

  it("wires copy button click to handler", () => {
    const dom = createMediaPopupDom(handlers);
    const copyBtn = dom.container.querySelector('button[title="Copy path"]') as HTMLElement;
    copyBtn.click();
    expect(handlers.onCopy).toHaveBeenCalledOnce();
  });

  it("wires delete button click to handler", () => {
    const dom = createMediaPopupDom(handlers);
    const deleteBtn = dom.container.querySelector('button[title="Remove media"]') as HTMLElement;
    deleteBtn.click();
    expect(handlers.onRemove).toHaveBeenCalledOnce();
  });

  it("wires keydown handler on all inputs", () => {
    const dom = createMediaPopupDom(handlers);
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true });

    dom.srcInput.dispatchEvent(event);
    dom.altInput.dispatchEvent(event);
    dom.titleInput.dispatchEvent(event);
    dom.posterInput.dispatchEvent(event);

    expect(handlers.onInputKeydown).toHaveBeenCalledTimes(4);
  });

  // --- Image-specific elements ---

  it("creates alt row with alt input and dimensions span", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.altRow).toBeInstanceOf(HTMLElement);
    expect(dom.altRow.className).toBe("media-popup-row");
    expect(dom.container.contains(dom.altRow)).toBe(true);
    expect(dom.altRow.contains(dom.altInput)).toBe(true);
    expect(dom.altRow.contains(dom.dimensionsSpan)).toBe(true);
  });

  it("creates alt input with correct placeholder", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.altInput).toBeInstanceOf(HTMLInputElement);
    expect(dom.altInput.placeholder).toContain("alt");
  });

  it("creates dimensions span", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.dimensionsSpan).toBeInstanceOf(HTMLElement);
    expect(dom.dimensionsSpan.className).toBe("media-popup-dimensions");
  });

  it("has toggle button", () => {
    const dom = createMediaPopupDom(handlers);
    expect(dom.toggleBtn).toBeInstanceOf(HTMLElement);
    expect(dom.toggleBtn.title).toBe("Toggle block/inline");
  });

  it("wires toggle button click to handler", () => {
    const dom = createMediaPopupDom(handlers);
    dom.toggleBtn.click();
    expect(handlers.onToggle).toHaveBeenCalledOnce();
  });
});

describe("updateMediaPopupToggleButton", () => {
  it("shows inline icon when current type is block_image", () => {
    const btn = document.createElement("button");
    updateMediaPopupToggleButton(btn, "block_image");
    expect(btn.innerHTML).toBe(popupIcons.inlineImage);
    expect(btn.title).toBe("Convert to inline");
  });

  it("shows block icon when current type is image", () => {
    const btn = document.createElement("button");
    updateMediaPopupToggleButton(btn, "image");
    expect(btn.innerHTML).toBe(popupIcons.blockImage);
    expect(btn.title).toBe("Convert to block");
  });
});

describe("installMediaPopupKeyboardNavigation", () => {
  let container: HTMLElement;
  let onClose: () => void;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);

    // Add focusable elements
    const input = document.createElement("input");
    input.type = "text";
    const btn1 = document.createElement("button");
    btn1.textContent = "Browse";
    const btn2 = document.createElement("button");
    btn2.textContent = "Delete";
    container.appendChild(input);
    container.appendChild(btn1);
    container.appendChild(btn2);

    // jsdom doesn't compute offsetParent — mock it so getFocusableElements
    // sees these elements as visible
    Object.defineProperty(input, "offsetParent", { value: container });
    Object.defineProperty(btn1, "offsetParent", { value: container });
    Object.defineProperty(btn2, "offsetParent", { value: container });

    onClose = vi.fn() as unknown as () => void;
    cleanup = installMediaPopupKeyboardNavigation(container, onClose);
  });

  afterEach(() => {
    cleanup();
    container.remove();
  });

  it("Tab cycles forward through focusable elements", () => {
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(container.querySelectorAll("button")[0]);
  });

  it("Tab wraps from last element to first", () => {
    const buttons = container.querySelectorAll("button");
    (buttons[1] as HTMLElement).focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(container.querySelector("input"));
  });

  it("Shift+Tab cycles backward", () => {
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(container.querySelectorAll("button")[1]);
  });

  it("Escape calls onClose", () => {
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(event);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores IME events", () => {
    vi.mocked(isImeKeyEvent).mockReturnValueOnce(true);

    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("cleanup removes keydown listener", () => {
    cleanup();

    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });
});
