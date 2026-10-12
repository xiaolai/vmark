/**
 * Tests for setupFloatingPrompt — the overlay that mirrors the input rows
 * while the viewport is scrolled back. A REAL (unopened) xterm drives the
 * buffer; the overlay is real DOM in a detached container. Rendering is
 * scheduled through an injected synchronous scheduler so each assertion sees
 * the state right after the event that caused it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createRealTerminal, writeParsed } from "./realXterm.testUtils";
import { setupFloatingPrompt } from "./setupFloatingPrompt";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function setup() {
  const term = createRealTerminal({ rows: 10, theme: { foreground: "#222222", background: "#fafafa", red: "#cc0000" } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const cleanup = setupFloatingPrompt({ term, container, schedule: (fn) => fn() });
  cleanups.push(() => {
    cleanup();
    container.remove();
  });
  const overlay = () => container.querySelector<HTMLElement>(".terminal-floating-prompt");
  const rows = () => Array.from(container.querySelectorAll<HTMLElement>(".terminal-floating-prompt-row"));
  const output = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\r\n");
  await writeParsed(term, `${output}\r\n$ `);
  return { term, container, cleanup, overlay, rows };
}

describe("setupFloatingPrompt", () => {
  it("stays hidden while the viewport is at the bottom", async () => {
    const { overlay } = await setup();
    expect(overlay()?.hidden).toBe(true);
  });

  it("shows the prompt rows once the viewport is scrolled back", async () => {
    const { term, overlay, rows } = await setup();
    term.scrollLines(-20);
    expect(overlay()?.hidden).toBe(false);
    expect(rows().map((r) => r.textContent?.trimEnd())).toEqual(["line 39", "$"]);
  });

  it("hides again when the viewport returns to the bottom", async () => {
    const { term, overlay } = await setup();
    term.scrollLines(-20);
    term.scrollToBottom();
    expect(overlay()?.hidden).toBe(true);
  });

  it("follows typing echoed into the buffer while scrolled back", async () => {
    const { term, rows } = await setup();
    term.scrollLines(-20);
    await writeParsed(term, "git status");
    expect(rows().at(-1)?.textContent?.trimEnd()).toBe("$ git status");
  });

  it("draws the cursor cell, and drops it while the program hides the cursor", async () => {
    const { term, container } = await setup();
    term.scrollLines(-20);
    expect(container.querySelectorAll(".terminal-floating-prompt-cursor")).toHaveLength(1);
    await writeParsed(term, "\x1b[?25l");
    expect(container.querySelectorAll(".terminal-floating-prompt-cursor")).toHaveLength(0);
    await writeParsed(term, "\x1b[?25h");
    expect(container.querySelectorAll(".terminal-floating-prompt-cursor")).toHaveLength(1);
  });

  it("applies resolved cell colours", async () => {
    const { term, container } = await setup();
    await writeParsed(term, "\x1b[31mred\x1b[0m");
    term.scrollLines(-20);
    const red = Array.from(container.querySelectorAll<HTMLElement>(".terminal-floating-prompt-row span"))
      .find((s) => s.textContent === "red");
    expect(red?.style.color).toBe("rgb(204, 0, 0)");
  });

  it("treats terminal output as text, never markup", async () => {
    const { term, container } = await setup();
    await writeParsed(term, "<img src=x onerror=alert(1)>");
    term.scrollLines(-20);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("jumps back to the prompt from its button and keeps focus where it was", async () => {
    const { term, overlay } = await setup();
    term.scrollLines(-20);
    const button = overlay()?.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe("Jump to prompt");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    overlay()?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    button?.click();
    expect(term.buffer.active.viewportY).toBe(term.buffer.active.baseY);
    expect(overlay()?.hidden).toBe(true);
  });

  // `input(data, false)` fires onData exactly like a keystroke but without
  // xterm's own scrollOnUserInput, which production turns off.
  it.each([
    ["Enter", "\r"],
    ["Enter in linefeed mode", "\r\n"],
    ["Ctrl+C", "\x03"],
  ])("jumps back to the prompt on %s, so the result is in view", async (_label, data) => {
    const { term, overlay } = await setup();
    term.scrollLines(-20);
    term.input(data, false);
    expect(term.buffer.active.viewportY).toBe(term.buffer.active.baseY);
    expect(overlay()?.hidden).toBe(true);
  });

  it.each([
    ["a printable key", "a"],
    ["Shift+Enter (CSI-u newline in a TUI input box)", "\x1b[13;2u"],
    ["a paste that contains a newline", "ls\r"],
    ["Backspace", "\x7f"],
  ])("keeps the viewport where it is on %s", async (_label, data) => {
    const { term, overlay } = await setup();
    term.scrollLines(-20);
    const viewportY = term.buffer.active.viewportY;
    term.input(data, false);
    expect(term.buffer.active.viewportY).toBe(viewportY);
    expect(overlay()?.hidden).toBe(false);
  });

  it("stops jumping on Enter after cleanup", async () => {
    const { term, cleanup } = await setup();
    cleanup();
    term.scrollLines(-20);
    const viewportY = term.buffer.active.viewportY;
    term.input("\r", false);
    expect(term.buffer.active.viewportY).toBe(viewportY);
  });

  it("stays hidden on the alternate screen", async () => {
    const { term, overlay } = await setup();
    term.scrollLines(-20);
    await writeParsed(term, "\x1b[?1049h");
    expect(overlay()?.hidden).toBe(true);
  });

  it("removes the overlay and stops listening on cleanup", async () => {
    const { term, container, cleanup } = await setup();
    cleanup();
    expect(container.querySelector(".terminal-floating-prompt")).toBeNull();
    term.scrollLines(-20);
    await writeParsed(term, "x");
    expect(container.querySelector(".terminal-floating-prompt")).toBeNull();
  });
});
