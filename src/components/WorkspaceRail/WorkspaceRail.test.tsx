import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { WorkspaceRail } from "./WorkspaceRail";

const { mockMoveWorkspace, mockDuplicateWorkspace, mockToastError, mockToastMessage } = vi.hoisted(() => ({
  mockMoveWorkspace: vi.fn(),
  mockDuplicateWorkspace: vi.fn(),
  mockToastError: vi.fn(),
  mockToastMessage: vi.fn(),
}));

vi.mock("@/services/workspaces/workspaceWindowActions", () => ({
  moveWorkspaceInstanceToNewWindow: mockMoveWorkspace,
  duplicateWorkspaceInstanceToNewWindow: mockDuplicateWorkspace,
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: mockToastError, message: mockToastMessage },
}));

function setRailMode(enabled: boolean): void {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, workspaceRailMode: enabled },
  });
}

function addInstance(windowLabel: string, id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: windowLabel,
      createdFrom: "open",
    }),
  );
}

beforeEach(() => {
  setRailMode(false);
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  mockMoveWorkspace.mockReset();
  mockDuplicateWorkspace.mockReset();
  mockToastError.mockReset();
  mockToastMessage.mockReset();
});

describe("WorkspaceRail", () => {
  it("renders nothing while workspace rail mode is disabled", () => {
    addInstance("main", "wsi-main", "/Users/xiaolai/project");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    expect(container.firstChild).toBeNull();
  });

  it("renders local workspace instances when enabled", () => {
    setRailMode(true);
    addInstance("main", "wsi-main", "/Users/xiaolai/project");
    addInstance("doc-1", "wsi-doc", "/Users/xiaolai/other");

    render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("navigation", { name: /workspaces/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /activate project/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate other/i })).not.toBeInTheDocument();
  });

  it("marks the active workspace instance", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-b");

    render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("button", { name: "Activate b" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Activate a" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders numbered folder indicators with stable workspace colors", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    const indicators = [...container.querySelectorAll(".workspace-rail__index")].map(
      (indicator) => indicator.textContent,
    );
    const entries = [...container.querySelectorAll<HTMLElement>(".workspace-rail__entry")];
    const folderIcon = container.querySelector(".workspace-rail__folder svg");
    expect(indicators).toEqual(["1", "2"]);
    expect(folderIcon).toHaveAttribute("width", "14");
    expect(folderIcon).toHaveAttribute("height", "14");
    expect(entries[0]?.style.getPropertyValue("--workspace-rail-color")).toMatch(/^var\(--/);
    expect(entries[1]?.style.getPropertyValue("--workspace-rail-color")).toMatch(/^var\(--/);
  });

  it("activates the clicked workspace instance", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Activate b" }));

    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.activeWorkspaceInstanceId,
    ).toBe("wsi-b");
  });

  it("moves a workspace when its icon is dragged outside the viewport", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");

    render(<WorkspaceRail windowLabel="main" />);
    const button = screen.getByRole("button", { name: "Activate a" });
    const event = createEvent.dragEnd(button);
    Object.defineProperties(event, {
      clientX: { value: -12 },
      clientY: { value: 20 },
    });
    fireEvent(button, event);

    expect(mockMoveWorkspace).toHaveBeenCalledWith("main", "wsi-a", expect.any(Object));
  });

  it("does not move a workspace when drag ends inside the viewport", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");

    render(<WorkspaceRail windowLabel="main" />);
    const button = screen.getByRole("button", { name: "Activate a" });
    const event = createEvent.dragEnd(button);
    Object.defineProperties(event, {
      clientX: { value: 12 },
      clientY: { value: 20 },
    });
    fireEvent(button, event);

    expect(mockMoveWorkspace).not.toHaveBeenCalled();
  });

  it("does not move a workspace when drag coordinates are unavailable", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");

    render(<WorkspaceRail windowLabel="main" />);
    const button = screen.getByRole("button", { name: "Activate a" });
    const event = createEvent.dragEnd(button);
    Object.defineProperties(event, {
      clientX: { value: Number.NaN },
      clientY: { value: 20 },
    });
    fireEvent(button, event);

    expect(mockMoveWorkspace).not.toHaveBeenCalled();
  });

  it("shows an error toast when moving a workspace fails", async () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    mockMoveWorkspace.mockResolvedValueOnce({ ok: false, reason: "timeout" });

    render(<WorkspaceRail windowLabel="main" />);
    const button = screen.getByRole("button", { name: "Activate a" });
    const event = createEvent.dragEnd(button);
    Object.defineProperties(event, {
      clientX: { value: globalThis.innerWidth },
      clientY: { value: 20 },
    });
    fireEvent(button, event);

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Failed to move workspace to a new window"),
    );
  });

  it("duplicates a workspace from the duplicate icon", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Duplicate a" }));

    expect(mockDuplicateWorkspace).toHaveBeenCalledWith("main", "wsi-a");
  });

  it("shows an error toast when duplicate fails", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    mockDuplicateWorkspace.mockResolvedValueOnce({ ok: false, reason: "invokeFailed" });

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Duplicate a" }));

    expect(mockToastError).toHaveBeenCalledWith("Failed to duplicate workspace");
  });

  it("reports skipped tabs after duplicate succeeds with skipped content", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    mockDuplicateWorkspace.mockResolvedValueOnce({
      ok: true,
      targetWindowLabel: "doc-2",
      skippedDirtyCount: 1,
      skippedUntitledCount: 1,
      skippedMissingCount: 1,
    });

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Duplicate a" }));

    expect(mockToastMessage).toHaveBeenCalledWith(
      "Duplicated workspace and skipped 3 dirty, untitled, or missing tabs.",
    );
  });

  it("does not report skipped tabs after a clean duplicate", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    mockDuplicateWorkspace.mockResolvedValueOnce({
      ok: true,
      targetWindowLabel: "doc-2",
    });

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Duplicate a" }));

    expect(mockToastMessage).not.toHaveBeenCalled();
  });
});
