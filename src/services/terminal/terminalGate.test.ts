import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

const mockGetCurrentWindowLabel = vi.fn(() => "main");
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => mockGetCurrentWindowLabel(),
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

  it("returns true when active tab has a saved file path", () => {
    useWorkspaceStore.setState({ isWorkspaceMode: false });
    const tabId = useTabStore.getState().createTab("main", "/docs/notes.md");
    useTabStore.getState().setActiveTab("main", tabId);
    useDocumentStore.getState().initDocument(tabId, "content", "/docs/notes.md");
    expect(canOpenTerminal()).toBe(true);
  });

  it("returns false when active tab is untitled (no file path)", () => {
    useWorkspaceStore.setState({ isWorkspaceMode: false });
    const tabId = useTabStore.getState().createTab("main");
    useTabStore.getState().setActiveTab("main", tabId);
    useDocumentStore.getState().initDocument(tabId, "content");
    expect(canOpenTerminal()).toBe(false);
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

  it("DOES toggle when active tab has a saved file (no workspace)", () => {
    useWorkspaceStore.setState({ isWorkspaceMode: false });
    const tabId = useTabStore.getState().createTab("main", "/docs/notes.md");
    useTabStore.getState().setActiveTab("main", tabId);
    useDocumentStore.getState().initDocument(tabId, "content", "/docs/notes.md");
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
