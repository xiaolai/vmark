/**
 * The ONE definition of "focus is inside the terminal".
 *
 * Two layers ask this question — the keybinding scope resolver and the
 * editor⇄terminal focus toggle — and a second copy of the selector is exactly
 * the drift where one stops matching while the other keeps working.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  TERMINAL_SURFACE_SELECTOR,
  isTerminalSurface,
  terminalHasFocus,
} from "./terminalSurface";

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isTerminalSurface", () => {
  it("matches xterm's own helper textarea", () => {
    const host = mount(`<div class="xterm"><textarea id="t"></textarea></div>`);
    expect(isTerminalSurface(host.querySelector("#t"))).toBe(true);
  });

  it("matches the panel's session container", () => {
    const host = mount(`<div class="terminal-container"><span id="s"></span></div>`);
    expect(isTerminalSurface(host.querySelector("#s"))).toBe(true);
  });

  it("does not match the editor", () => {
    const host = mount(`<div class="ProseMirror"><p id="p">x</p></div>`);
    expect(isTerminalSurface(host.querySelector("#p"))).toBe(false);
  });

  it("is null-safe", () => {
    expect(isTerminalSurface(null)).toBe(false);
    expect(isTerminalSurface(undefined)).toBe(false);
  });

  it("names both surfaces in one selector", () => {
    expect(TERMINAL_SURFACE_SELECTOR).toContain(".xterm");
    expect(TERMINAL_SURFACE_SELECTOR).toContain(".terminal-container");
  });
});

describe("terminalHasFocus", () => {
  it("is true when the caret is inside the terminal", () => {
    const host = mount(`<div class="xterm"><textarea id="t"></textarea></div>`);
    (host.querySelector("#t") as HTMLTextAreaElement).focus();
    expect(terminalHasFocus()).toBe(true);
  });

  it("is false when the caret is elsewhere", () => {
    const host = mount(`<textarea id="other"></textarea>`);
    (host.querySelector("#other") as HTMLTextAreaElement).focus();
    expect(terminalHasFocus()).toBe(false);
  });

  it("is false when nothing is focused", () => {
    expect(terminalHasFocus()).toBe(false);
  });
});
