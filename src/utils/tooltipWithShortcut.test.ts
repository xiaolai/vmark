// Empty-safe tooltip builder: appends "(KEY)" only when a shortcut exists.

import { describe, it, expect } from "vitest";
import { tooltipWithShortcut } from "./tooltipWithShortcut";

describe("tooltipWithShortcut", () => {
  it("returns the label unchanged when the key is empty", () => {
    expect(tooltipWithShortcut("Open Sidebar", "")).toBe("Open Sidebar");
  });

  it("appends the formatted key in parentheses when present", () => {
    expect(tooltipWithShortcut("Toggle Sidebar", "⌃⇧0")).toBe("Toggle Sidebar (⌃⇧0)");
  });

  it("treats a whitespace-only key as empty (no empty parens)", () => {
    expect(tooltipWithShortcut("Open Sidebar", "   ")).toBe("Open Sidebar");
  });

  it("trims surrounding whitespace from the key", () => {
    expect(tooltipWithShortcut("New Tab", "  ⌘T  ")).toBe("New Tab (⌘T)");
  });

  it("works with non-mac display strings", () => {
    expect(tooltipWithShortcut("Open Sidebar", "Ctrl+Shift+0")).toBe("Open Sidebar (Ctrl+Shift+0)");
  });
});
