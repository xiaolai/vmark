import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUIStore } from "@/stores/uiStore";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

import { toast } from "sonner";
import { canOpenTerminal, requestToggleTerminal } from "./terminalGate";

beforeEach(() => {
  // Reset stores
  useWorkspaceStore.setState({ isWorkspaceMode: false, rootPath: null });
  useUIStore.setState({ terminalVisible: false });
  vi.clearAllMocks();
});

describe("canOpenTerminal", () => {
  it("returns false when isWorkspaceMode is false", () => {
    useWorkspaceStore.setState({ isWorkspaceMode: false });
    expect(canOpenTerminal()).toBe(false);
  });

  it("returns true when isWorkspaceMode is true", () => {
    useWorkspaceStore.setState({ isWorkspaceMode: true });
    expect(canOpenTerminal()).toBe(true);
  });
});

describe("requestToggleTerminal", () => {
  it("does NOT toggle when opening without workspace", () => {
    useWorkspaceStore.setState({ isWorkspaceMode: false });
    useUIStore.setState({ terminalVisible: false });

    requestToggleTerminal();

    expect(useUIStore.getState().terminalVisible).toBe(false);
    expect(toast.info).toHaveBeenCalledWith(
      "Open a folder or save your file to use the terminal."
    );
  });

  it("DOES toggle when opening with workspace", () => {
    useWorkspaceStore.setState({ isWorkspaceMode: true });
    useUIStore.setState({ terminalVisible: false });

    requestToggleTerminal();

    expect(useUIStore.getState().terminalVisible).toBe(true);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("ALWAYS toggles when closing (terminal already visible)", () => {
    useWorkspaceStore.setState({ isWorkspaceMode: false });
    useUIStore.setState({ terminalVisible: true });

    requestToggleTerminal();

    expect(useUIStore.getState().terminalVisible).toBe(false);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
