// MainWindowRunners — pins the main-window-only lifecycle wiring:
// every lifecycle hook and shortcut runner mounts exactly once, the
// resilience startup runs before the Finder file-open handler (order
// contract: saved-session restore must win the race against a pending
// Finder open), and unmounting the tree unmounts every runner.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("@/hooks/useMcpAutoStart", () => ({
  useMcpAutoStart: () => calls.push("mcpAutoStart"),
}));
vi.mock("@/hooks/useUpdateChecker", () => ({
  useUpdateChecker: () => calls.push("updateChecker"),
}));
vi.mock("@/hooks/useUpdateSync", () => ({
  useUpdateBroadcast: () => calls.push("updateBroadcast"),
  useUpdateListener: () => calls.push("updateListener"),
}));
vi.mock("@/services/persistence/resilience", () => ({
  useResilienceStartup: () => calls.push("resilienceStartup"),
}));
vi.mock("@/services/persistence/hotExit/useHotExitCaptureWarning", () => ({
  useHotExitCaptureWarning: () => calls.push("hotExitCaptureWarning"),
}));
vi.mock("@/hooks/useFinderFileOpen", () => ({
  useFinderFileOpen: () => calls.push("finderFileOpen"),
}));
vi.mock("@/hooks/useGenieShortcuts", () => ({
  useGenieShortcuts: () => calls.push("genieShortcuts"),
}));
vi.mock("@/hooks/useQuickOpenShortcuts", () => ({
  useQuickOpenShortcuts: () => calls.push("quickOpenShortcuts"),
}));
vi.mock("@/components/ContentSearch/useContentSearchShortcuts", () => ({
  useContentSearchShortcuts: () => calls.push("contentSearchShortcuts"),
}));
vi.mock("@/components/CommandPalette", () => ({
  useCommandPaletteShortcut: () => calls.push("commandPaletteShortcut"),
}));

import { MainWindowRunners } from "../MainWindowRunners";

beforeEach(() => {
  calls.length = 0;
});

describe("MainWindowRunners", () => {
  it("mounts every lifecycle hook and shortcut runner exactly once", () => {
    render(<MainWindowRunners />);
    expect([...calls].sort()).toEqual(
      [
        "mcpAutoStart",
        "updateChecker",
        "updateBroadcast",
        "updateListener",
        "resilienceStartup",
        "hotExitCaptureWarning",
        "finderFileOpen",
        "genieShortcuts",
        "quickOpenShortcuts",
        "contentSearchShortcuts",
        "commandPaletteShortcut",
      ].sort(),
    );
    // Exactly once each — no duplicate mounts.
    expect(calls).toHaveLength(11);
  });

  it("runs resilience startup before the Finder file-open handler (order contract)", () => {
    render(<MainWindowRunners />);
    expect(calls.indexOf("resilienceStartup")).toBeLessThan(
      calls.indexOf("finderFileOpen"),
    );
  });

  it("renders no visible DOM (pure lifecycle wiring)", () => {
    const { container } = render(<MainWindowRunners />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not re-run lifecycle hooks after unmount", () => {
    const { unmount } = render(<MainWindowRunners />);
    const countAtUnmount = calls.length;
    unmount();
    expect(calls).toHaveLength(countAtUnmount);
  });
});
