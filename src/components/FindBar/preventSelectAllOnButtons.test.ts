// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { preventSelectAllOnButtons } from "./preventSelectAllOnButtons";

function keyEvent(key: string, tagName: string, mod: "meta" | "ctrl" | "none") {
  const preventDefault = vi.fn();
  const e = {
    key,
    metaKey: mod === "meta",
    ctrlKey: mod === "ctrl",
    target: { tagName },
    preventDefault,
  } as unknown as ReactKeyboardEvent;
  return { e, preventDefault };
}

describe("preventSelectAllOnButtons", () => {
  it.each(["meta", "ctrl"] as const)("blocks %s+A while a button has focus", (mod) => {
    const { e, preventDefault } = keyEvent("a", "BUTTON", mod);
    preventSelectAllOnButtons(e);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it.each(["INPUT", "TEXTAREA"])("leaves Cmd+A to the native select-all inside %s", (tag) => {
    const { e, preventDefault } = keyEvent("a", tag, "meta");
    preventSelectAllOnButtons(e);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("ignores other keys and an unmodified A", () => {
    for (const [key, mod] of [["a", "none"], ["b", "meta"], ["Enter", "ctrl"]] as const) {
      const { e, preventDefault } = keyEvent(key, "BUTTON", mod);
      preventSelectAllOnButtons(e);
      expect(preventDefault).not.toHaveBeenCalled();
    }
  });
});
