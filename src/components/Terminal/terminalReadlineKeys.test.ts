// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type React from "react";
import type { IPty } from "@/lib/pty";
import { handleReadlineNavKey } from "./terminalReadlineKeys";

vi.mock("@/utils/shortcutMatch", () => ({
  isMacPlatform: () => macPlatform.value,
}));
const macPlatform = { value: true };

function makeEvent(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...mods,
  } as unknown as KeyboardEvent;
}

describe("handleReadlineNavKey (macOS)", () => {
  let write: ReturnType<typeof vi.fn>;
  let ptyRef: React.RefObject<IPty | null>;

  beforeEach(() => {
    macPlatform.value = true;
    write = vi.fn();
    ptyRef = { current: { write } as unknown as IPty };
  });
  afterEach(() => vi.clearAllMocks());

  it.each([
    ["Cmd+Left → ^A", "ArrowLeft", { metaKey: true }, "\x01"],
    ["Cmd+Right → ^E", "ArrowRight", { metaKey: true }, "\x05"],
    ["Option+Left → Alt-b", "ArrowLeft", { altKey: true }, "\x1bb"],
    ["Option+Right → Alt-f", "ArrowRight", { altKey: true }, "\x1bf"],
    ["Cmd+Backspace → ^U", "Backspace", { metaKey: true }, "\x15"],
  ])("%s", (_label, key, mods, byte) => {
    const event = makeEvent(key, mods);
    expect(handleReadlineNavKey(event, ptyRef)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(byte);
  });

  it("does not handle Option+Backspace (shell owns backward-kill-word)", () => {
    const event = makeEvent("Backspace", { altKey: true });
    expect(handleReadlineNavKey(event, ptyRef)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not handle plain Backspace (one-char delete)", () => {
    expect(handleReadlineNavKey(makeEvent("Backspace"), ptyRef)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not handle Cmd+Shift+Left (selection, not cursor move)", () => {
    const event = makeEvent("ArrowLeft", { metaKey: true, shiftKey: true });
    expect(handleReadlineNavKey(event, ptyRef)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("returns false for a normal key", () => {
    expect(handleReadlineNavKey(makeEvent("a"), ptyRef)).toBe(false);
  });

  it("no-ops entirely on non-macOS", () => {
    macPlatform.value = false;
    const event = makeEvent("Backspace", { metaKey: true });
    expect(handleReadlineNavKey(event, ptyRef)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("tolerates a null pty (returns true, no throw)", () => {
    const event = makeEvent("ArrowLeft", { metaKey: true });
    expect(handleReadlineNavKey(event, { current: null })).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
