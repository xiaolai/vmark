// useWindowLifecycle — pins the window-chrome + resilience composite:
// every window-level hook mounts once, in the documented order
// (close → title → file watcher → resilience → MCP bridge).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("@/hooks/useWindowClose", () => ({
  useWindowClose: () => calls.push("windowClose"),
}));
vi.mock("@/hooks/useWindowTitle", () => ({
  useWindowTitle: () => calls.push("windowTitle"),
}));
vi.mock("@/hooks/useWindowFileWatcher", () => ({
  useWindowFileWatcher: () => calls.push("windowFileWatcher"),
}));
vi.mock("@/services/persistence/resilience", () => ({
  useDocumentResilience: () => calls.push("documentResilience"),
}));
vi.mock("@/hooks/useMcpBridge", () => ({
  useMcpBridge: () => calls.push("mcpBridge"),
}));

import { useWindowLifecycle } from "../useWindowLifecycle";

beforeEach(() => {
  calls.length = 0;
});

describe("useWindowLifecycle", () => {
  it("mounts every window hook exactly once, in the documented order", () => {
    renderHook(() => useWindowLifecycle());
    expect(calls).toEqual([
      "windowClose",
      "windowTitle",
      "windowFileWatcher",
      "documentResilience",
      "mcpBridge",
    ]);
  });

  it("registers the close handler before resilience capture (order contract)", () => {
    renderHook(() => useWindowLifecycle());
    expect(calls.indexOf("windowClose")).toBeLessThan(
      calls.indexOf("documentResilience"),
    );
  });
});
