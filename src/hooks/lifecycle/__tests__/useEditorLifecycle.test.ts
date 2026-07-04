// useEditorLifecycle — the composite's entire contract is (a) every
// editor-level hook mounts, and (b) the documented order holds:
// command bootstrap registers menu listeners BEFORE any shortcut hook
// can fire a synthetic event. These tests pin both.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("@/services/commands", () => ({
  useCommandBootstrap: () => calls.push("commandBootstrap"),
}));
vi.mock("@/hooks/useSearchCommands", () => ({
  useSearchCommands: () => calls.push("searchCommands"),
}));
vi.mock("@/hooks/useViewShortcuts", () => ({
  useViewShortcuts: () => calls.push("viewShortcuts"),
}));
vi.mock("@/hooks/useTabShortcuts", () => ({
  useTabShortcuts: () => calls.push("tabShortcuts"),
}));
vi.mock("@/hooks/useFileExplorerShortcuts", () => ({
  useFileExplorerShortcuts: () => calls.push("fileExplorerShortcuts"),
}));
vi.mock("@/hooks/useUniversalToolbar", () => ({
  useUniversalToolbar: () => calls.push("universalToolbar"),
}));
vi.mock("@/hooks/useFormatsUpgradeNudge", () => ({
  useFormatsUpgradeNudge: () => calls.push("formatsUpgradeNudge"),
}));
vi.mock("@/hooks/useMarkdownSplitDefault", () => ({
  useMarkdownSplitDefault: () => calls.push("markdownSplitDefault"),
}));
vi.mock("@/hooks/useViewMenuStateSync", () => ({
  useViewMenuStateSync: () => calls.push("viewMenuStateSync"),
}));

import { useEditorLifecycle } from "../useEditorLifecycle";

beforeEach(() => {
  calls.length = 0;
});

describe("useEditorLifecycle", () => {
  it("mounts every editor hook exactly once, in the documented order", () => {
    renderHook(() => useEditorLifecycle());
    expect(calls).toEqual([
      "commandBootstrap",
      "searchCommands",
      "viewShortcuts",
      "tabShortcuts",
      "fileExplorerShortcuts",
      "universalToolbar",
      "formatsUpgradeNudge",
      "markdownSplitDefault",
      "viewMenuStateSync",
    ]);
  });

  it("runs the command bootstrap before any shortcut hook (order contract)", () => {
    renderHook(() => useEditorLifecycle());
    const bootstrapIdx = calls.indexOf("commandBootstrap");
    for (const shortcutHook of [
      "searchCommands",
      "viewShortcuts",
      "tabShortcuts",
      "fileExplorerShortcuts",
    ]) {
      expect(bootstrapIdx).toBeLessThan(calls.indexOf(shortcutHook));
    }
  });
});
