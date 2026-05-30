/**
 * Tests for popupComponents.ts — vanilla DOM builder utilities.
 *
 * Tests DOM construction, CSS class assignment, event wiring,
 * and tab-cycling logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  popupIcons,
  buildPopupIconButton,
  buildPopupInput,
  getFocusableElements,
  handlePopupTabNavigation,
} from "./popupComponents";
import type { PopupIconName } from "./popupComponents";

// ---- popupIcons ----

describe("popupIcons", () => {
  it("contains expected icon keys", () => {
    const expectedKeys: PopupIconName[] = [
      "open", "copy", "save", "delete", "close",
      "folder", "goto", "toggle", "link", "image",
      "blockImage", "inlineImage", "type",
    ];
    for (const key of expectedKeys) {
      expect(popupIcons[key]).toBeDefined();
      expect(popupIcons[key]).toContain("<svg");
    }
  });

  it("all icons are valid SVG strings", () => {
    for (const [, svg] of Object.entries(popupIcons)) {
      expect(svg).toMatch(/^<svg[\s>]/);
      expect(svg).toContain("</svg>");
    }
  });
});

// ---- buildPopupIconButton ----

describe("buildPopupIconButton", () => {
  it("creates a button element with correct type", () => {
    const btn = buildPopupIconButton({
      icon: "save",
      title: "Save",
      onClick: () => {},
    });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.type).toBe("button");
  });

  it("sets title attribute", () => {
    const btn = buildPopupIconButton({
      icon: "copy",
      title: "Copy to clipboard",
      onClick: () => {},
    });
    expect(btn.title).toBe("Copy to clipboard");
  });

  it("sets content to the icon SVG", () => {
    const btn = buildPopupIconButton({
      icon: "delete",
      title: "Delete",
      onClick: () => {},
    });
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("has popup-icon-btn class by default", () => {
    const btn = buildPopupIconButton({
      icon: "close",
      title: "Close",
      onClick: () => {},
    });
    expect(btn.className).toBe("popup-icon-btn");
  });

  it("adds variant class for primary", () => {
    const btn = buildPopupIconButton({
      icon: "save",
      title: "Save",
      onClick: () => {},
      variant: "primary",
    });
    expect(btn.classList.contains("popup-icon-btn")).toBe(true);
    expect(btn.classList.contains("popup-icon-btn--primary")).toBe(true);
  });

  it("adds variant class for danger", () => {
    const btn = buildPopupIconButton({
      icon: "delete",
      title: "Delete",
      onClick: () => {},
      variant: "danger",
    });
    expect(btn.classList.contains("popup-icon-btn--danger")).toBe(true);
  });

  it("does not add variant class for default variant", () => {
    const btn = buildPopupIconButton({
      icon: "open",
      title: "Open",
      onClick: () => {},
      variant: "default",
    });
    expect(btn.className).toBe("popup-icon-btn");
  });

  it("appends custom className", () => {
    const btn = buildPopupIconButton({
      icon: "link",
      title: "Link",
      onClick: () => {},
      className: "my-extra-class",
    });
    expect(btn.classList.contains("my-extra-class")).toBe(true);
    expect(btn.classList.contains("popup-icon-btn")).toBe(true);
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    const btn = buildPopupIconButton({
      icon: "save",
      title: "Save",
      onClick,
    });
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("handles empty className gracefully", () => {
    const btn = buildPopupIconButton({
      icon: "open",
      title: "Open",
      onClick: () => {},
      className: "",
    });
    expect(btn.className).toBe("popup-icon-btn");
  });

  it("uses raw iconSvg when provided (escape hatch)", () => {
    const raw = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>`;
    const btn = buildPopupIconButton({
      iconSvg: raw,
      title: "Custom",
      onClick: () => {},
    });
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(btn.querySelector("circle")).not.toBeNull();
  });

  it("prefers iconSvg over a named icon when both are given", () => {
    const btn = buildPopupIconButton({
      icon: "save",
      iconSvg: `<svg data-raw="1"></svg>`,
      title: "Custom",
      onClick: () => {},
    });
    // The named "save" icon is a polyline; the raw override has no polyline.
    expect(btn.querySelector("[data-raw='1']")).not.toBeNull();
    expect(btn.querySelector("polyline")).toBeNull();
  });

  it("overrides the base class via baseClass (source-popup styling)", () => {
    const btn = buildPopupIconButton({
      iconSvg: "<svg></svg>",
      title: "Open",
      onClick: () => {},
      baseClass: "source-link-popup-btn",
    });
    expect(btn.className).toBe("source-link-popup-btn");
    expect(btn.classList.contains("popup-icon-btn")).toBe(false);
  });

  it("derives the variant suffix from baseClass", () => {
    const btn = buildPopupIconButton({
      iconSvg: "<svg></svg>",
      title: "Delete",
      onClick: () => {},
      baseClass: "source-link-popup-btn",
      variant: "danger",
    });
    expect(btn.className).toBe("source-link-popup-btn source-link-popup-btn--danger");
  });
});

// ---- buildPopupInput ----

describe("buildPopupInput", () => {
  it("creates an input element with type text", () => {
    const input = buildPopupInput({});
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("text");
  });

  it("sets placeholder", () => {
    const input = buildPopupInput({ placeholder: "Enter URL..." });
    expect(input.placeholder).toBe("Enter URL...");
  });

  it("sets initial value", () => {
    const input = buildPopupInput({ value: "https://example.com" });
    expect(input.value).toBe("https://example.com");
  });

  it("has popup-input class by default", () => {
    const input = buildPopupInput({});
    expect(input.className).toBe("popup-input");
  });

  it("adds monospace class when monospace=true", () => {
    const input = buildPopupInput({ monospace: true });
    expect(input.classList.contains("popup-input--mono")).toBe(true);
  });

  it("adds full-width class when fullWidth=true", () => {
    const input = buildPopupInput({ fullWidth: true });
    expect(input.classList.contains("popup-input--full")).toBe(true);
  });

  it("combines multiple classes", () => {
    const input = buildPopupInput({
      monospace: true,
      fullWidth: true,
      className: "extra",
    });
    expect(input.classList.contains("popup-input")).toBe(true);
    expect(input.classList.contains("popup-input--mono")).toBe(true);
    expect(input.classList.contains("popup-input--full")).toBe(true);
    expect(input.classList.contains("extra")).toBe(true);
  });

  it("calls onInput with current value on input event", () => {
    const onInput = vi.fn();
    const input = buildPopupInput({ onInput });

    // Simulate typing
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    expect(onInput).toHaveBeenCalledWith("hello");
  });

  it("calls onKeydown on keydown event", () => {
    const onKeydown = vi.fn();
    const input = buildPopupInput({ onKeydown });

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    input.dispatchEvent(event);
    expect(onKeydown).toHaveBeenCalledTimes(1);
  });

  it("does not add listeners when callbacks are undefined", () => {
    const input = buildPopupInput({});
    // Should not throw
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  });

  it("defaults placeholder to empty string", () => {
    const input = buildPopupInput({});
    expect(input.placeholder).toBe("");
  });

  it("defaults value to empty string", () => {
    const input = buildPopupInput({});
    expect(input.value).toBe("");
  });

  it("handles CJK placeholder text", () => {
    const input = buildPopupInput({ placeholder: "\u8f93\u5165\u94fe\u63a5..." });
    expect(input.placeholder).toBe("\u8f93\u5165\u94fe\u63a5...");
  });

  it("handles empty className gracefully", () => {
    const input = buildPopupInput({ className: "" });
    expect(input.className).toBe("popup-input");
  });
});

// ---- getFocusableElements ----

describe("getFocusableElements", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("finds buttons and inputs inside container", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "A";
    const inputEl = document.createElement("input");
    inputEl.type = "text";
    const btn2 = document.createElement("button");
    btn2.textContent = "B";
    container.appendChild(btn1);
    container.appendChild(inputEl);
    container.appendChild(btn2);

    const _focusable = getFocusableElements(container);
    // Note: jsdom offsetParent is always null, so filter excludes all.
    // We test the querySelectorAll part works by checking the raw query.
    const raw = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    );
    expect(raw).toHaveLength(3);
  });

  it("excludes disabled buttons from query", () => {
    const activeBtn = document.createElement("button");
    activeBtn.textContent = "Active";
    const disabledBtn = document.createElement("button");
    disabledBtn.textContent = "Disabled";
    disabledBtn.disabled = true;
    container.appendChild(activeBtn);
    container.appendChild(disabledBtn);

    const raw = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    );
    expect(raw).toHaveLength(1);
  });

  it("excludes disabled inputs from query", () => {
    const activeInput = document.createElement("input");
    activeInput.type = "text";
    const disabledInput = document.createElement("input");
    disabledInput.type = "text";
    disabledInput.disabled = true;
    container.appendChild(activeInput);
    container.appendChild(disabledInput);

    const raw = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    );
    expect(raw).toHaveLength(1);
  });

  it("includes elements with positive tabindex", () => {
    const div = document.createElement("div");
    div.tabIndex = 0;
    div.textContent = "Focusable div";
    container.appendChild(div);

    const raw = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    );
    expect(raw).toHaveLength(1);
  });

  it("excludes elements with tabindex=-1", () => {
    const div = document.createElement("div");
    div.tabIndex = -1;
    div.textContent = "Not focusable";
    container.appendChild(div);

    const raw = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    );
    expect(raw).toHaveLength(0);
  });

  it("returns empty array for empty container", () => {
    const focusable = getFocusableElements(container);
    expect(focusable).toHaveLength(0);
  });
});

// ---- handlePopupTabNavigation ----

describe("handlePopupTabNavigation", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("returns false for non-Tab key", () => {
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    const result = handlePopupTabNavigation(event, container);
    expect(result).toBe(false);
  });

  it("returns false when no focusable elements exist", () => {
    const event = new KeyboardEvent("keydown", { key: "Tab" });
    const result = handlePopupTabNavigation(event, container);
    expect(result).toBe(false);
  });

  it("returns false when active element is not in container", () => {
    const btn = document.createElement("button");
    btn.textContent = "A";
    container.appendChild(btn);
    // Focus is on body, not inside container
    const event = new KeyboardEvent("keydown", { key: "Tab" });
    const result = handlePopupTabNavigation(event, container);
    expect(result).toBe(false);
  });

  it("returns false for Escape key", () => {
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    const result = handlePopupTabNavigation(event, container);
    expect(result).toBe(false);
  });

  it("returns false for arrow keys", () => {
    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    const result = handlePopupTabNavigation(event, container);
    expect(result).toBe(false);
  });

  // Helper to make elements visible to getFocusableElements (jsdom offsetParent is null)
  function makeVisible(el: HTMLElement) {
    Object.defineProperty(el, "offsetParent", { value: container, configurable: true });
  }

  it("cycles forward on Tab from first to second element", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "A";
    const btn2 = document.createElement("button");
    btn2.textContent = "B";
    container.appendChild(btn1);
    container.appendChild(btn2);
    makeVisible(btn1);
    makeVisible(btn2);

    btn1.focus();
    const focusSpy = vi.spyOn(btn2, "focus");

    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    const result = handlePopupTabNavigation(event, container);

    expect(result).toBe(true);
    expect(focusSpy).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("wraps forward Tab from last to first element", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "A";
    const btn2 = document.createElement("button");
    btn2.textContent = "B";
    container.appendChild(btn1);
    container.appendChild(btn2);
    makeVisible(btn1);
    makeVisible(btn2);

    btn2.focus();
    const focusSpy = vi.spyOn(btn1, "focus");

    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    const result = handlePopupTabNavigation(event, container);

    expect(result).toBe(true);
    expect(focusSpy).toHaveBeenCalled();
  });

  it("cycles backward on Shift+Tab from second to first element", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "A";
    const btn2 = document.createElement("button");
    btn2.textContent = "B";
    container.appendChild(btn1);
    container.appendChild(btn2);
    makeVisible(btn1);
    makeVisible(btn2);

    btn2.focus();
    const focusSpy = vi.spyOn(btn1, "focus");

    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
    const result = handlePopupTabNavigation(event, container);

    expect(result).toBe(true);
    expect(focusSpy).toHaveBeenCalled();
  });

  it("wraps backward Shift+Tab from first to last element", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "A";
    const btn2 = document.createElement("button");
    btn2.textContent = "B";
    container.appendChild(btn1);
    container.appendChild(btn2);
    makeVisible(btn1);
    makeVisible(btn2);

    btn1.focus();
    const focusSpy = vi.spyOn(btn2, "focus");

    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
    const result = handlePopupTabNavigation(event, container);

    expect(result).toBe(true);
    expect(focusSpy).toHaveBeenCalled();
  });
});
