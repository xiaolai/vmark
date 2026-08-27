import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WelcomeScreen } from "./WelcomeScreen";

const mocks = vi.hoisted(() => ({
  handleNew: vi.fn(),
  handleOpen: vi.fn(() => Promise.resolve()),
  executeCommand: vi.fn(() => Promise.resolve(true)),
  fileOpsError: vi.fn(),
  recentFiles: [] as Array<{ path: string; name: string; timestamp: number }>,
  recentWorkspaces: [] as Array<{ path: string; name: string; timestamp: number }>,
}));

vi.mock("@/utils/debug", () => ({ fileOpsError: mocks.fileOpsError }));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

vi.mock("@/services/navigation/fileOpen", () => ({
  handleNew: mocks.handleNew,
  handleOpen: mocks.handleOpen,
}));

vi.mock("@/services/commands", () => ({
  executeCommand: mocks.executeCommand,
}));

vi.mock("@/stores/workspaceStore", () => ({
  useRecentFilesStore: (selector: (s: { files: typeof mocks.recentFiles }) => unknown) =>
    selector({ files: mocks.recentFiles }),
  useRecentWorkspacesStore: (
    selector: (s: { workspaces: typeof mocks.recentWorkspaces }) => unknown,
  ) => selector({ workspaces: mocks.recentWorkspaces }),
}));

describe("WelcomeScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recentFiles = [];
    mocks.recentWorkspaces = [];
  });

  it("renders the three quick-action buttons", () => {
    render(<WelcomeScreen />);
    expect(screen.getByRole("button", { name: "New File" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open File" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Folder" })).toBeInTheDocument();
  });

  it("creates a new file for the current window on New File click", async () => {
    const user = userEvent.setup();
    render(<WelcomeScreen />);
    await user.click(screen.getByRole("button", { name: "New File" }));
    expect(mocks.handleNew).toHaveBeenCalledWith("main");
  });

  it("opens the file dialog on Open File click", async () => {
    const user = userEvent.setup();
    render(<WelcomeScreen />);
    await user.click(screen.getByRole("button", { name: "Open File" }));
    expect(mocks.handleOpen).toHaveBeenCalledWith("main");
  });

  it("runs the workspace.openFolder command on Open Folder click", async () => {
    const user = userEvent.setup();
    render(<WelcomeScreen />);
    await user.click(screen.getByRole("button", { name: "Open Folder" }));
    expect(mocks.executeCommand).toHaveBeenCalledWith("workspace.openFolder", undefined, {
      windowLabel: "main",
    });
  });

  it("shows one empty-state message when nothing is recent", () => {
    render(<WelcomeScreen />);
    expect(screen.getByText("No recent files or workspaces")).toBeInTheDocument();
    // A heading over an empty list is noise; neither section is rendered.
    expect(screen.queryByText("Recent Files")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent Workspaces")).not.toBeInTheDocument();
  });

  it("renders recent files and opens one on click", async () => {
    mocks.recentFiles = [
      { path: "/docs/notes.md", name: "notes.md", timestamp: 2 },
      { path: "/docs/draft.md", name: "draft.md", timestamp: 1 },
    ];
    const user = userEvent.setup();
    render(<WelcomeScreen />);

    expect(screen.queryByText("No recent files or workspaces")).not.toBeInTheDocument();
    expect(screen.getByText("Recent Files")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /draft\.md/ }));
    expect(mocks.executeCommand).toHaveBeenCalledWith("file.openRecent", "/docs/draft.md", {
      windowLabel: "main",
    });
  });

  it("logs (does not throw) when Open File rejects", async () => {
    mocks.handleOpen.mockImplementationOnce(() => Promise.reject(new Error("dialog failed")));
    const user = userEvent.setup();
    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "Open File" }));

    await waitFor(() =>
      expect(mocks.fileOpsError).toHaveBeenCalledWith(
        "Welcome: open file failed:",
        expect.any(Error),
      ),
    );
  });

  it("logs (does not throw) when Open Folder rejects", async () => {
    mocks.executeCommand.mockImplementationOnce(() => Promise.reject(new Error("picker failed")));
    const user = userEvent.setup();
    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "Open Folder" }));

    await waitFor(() =>
      expect(mocks.fileOpsError).toHaveBeenCalledWith(
        "Welcome: open folder failed:",
        expect.any(Error),
      ),
    );
  });

  it("logs (does not throw) when opening a recent file rejects", async () => {
    mocks.recentFiles = [{ path: "/docs/draft.md", name: "draft.md", timestamp: 1 }];
    mocks.executeCommand.mockImplementationOnce(() => Promise.reject(new Error("open failed")));
    const user = userEvent.setup();
    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: /draft\.md/ }));

    await waitFor(() =>
      expect(mocks.fileOpsError).toHaveBeenCalledWith(
        "Welcome: open recent failed:",
        expect.any(Error),
      ),
    );
  });
});

// #1331 — the recent-workspaces store was populated on every workspace open and
// shown nowhere on this screen. Reopening a project from an empty window meant
// walking the folder picker again.
describe("WelcomeScreen — recent workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recentFiles = [];
    mocks.recentWorkspaces = [];
  });

  it("renders recent workspaces and opens one on click", async () => {
    mocks.recentWorkspaces = [
      { path: "/code/vmark", name: "vmark", timestamp: 2 },
      { path: "/code/notes", name: "notes", timestamp: 1 },
    ];
    const user = userEvent.setup();
    render(<WelcomeScreen />);

    expect(screen.getByText("Recent Workspaces")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /\/code\/notes/ }));
    expect(mocks.executeCommand).toHaveBeenCalledWith("workspace.openRecent", "/code/notes", {
      windowLabel: "main",
    });
  });

  it("shows both lists at once, each with its own heading", () => {
    mocks.recentFiles = [{ path: "/docs/notes.md", name: "notes.md", timestamp: 2 }];
    mocks.recentWorkspaces = [{ path: "/code/vmark", name: "vmark", timestamp: 1 }];
    render(<WelcomeScreen />);

    expect(screen.getByText("Recent Files")).toBeInTheDocument();
    expect(screen.getByText("Recent Workspaces")).toBeInTheDocument();
    expect(screen.queryByText("No recent files or workspaces")).not.toBeInTheDocument();
  });

  // Each list stands on its own: having files does not imply having workspaces.
  it("omits the workspaces section when only files are recent", () => {
    mocks.recentFiles = [{ path: "/docs/notes.md", name: "notes.md", timestamp: 1 }];
    render(<WelcomeScreen />);

    expect(screen.getByText("Recent Files")).toBeInTheDocument();
    expect(screen.queryByText("Recent Workspaces")).not.toBeInTheDocument();
    expect(screen.queryByText("No recent files or workspaces")).not.toBeInTheDocument();
  });

  it("omits the files section when only workspaces are recent", () => {
    mocks.recentWorkspaces = [{ path: "/code/vmark", name: "vmark", timestamp: 1 }];
    render(<WelcomeScreen />);

    expect(screen.getByText("Recent Workspaces")).toBeInTheDocument();
    expect(screen.queryByText("Recent Files")).not.toBeInTheDocument();
  });

  it("logs (does not throw) when opening a recent workspace rejects", async () => {
    mocks.recentWorkspaces = [{ path: "/code/vmark", name: "vmark", timestamp: 1 }];
    mocks.executeCommand.mockImplementationOnce(() => Promise.reject(new Error("open failed")));
    const user = userEvent.setup();
    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: /\/code\/vmark/ }));

    await waitFor(() =>
      expect(mocks.fileOpsError).toHaveBeenCalledWith(
        "Welcome: open recent workspace failed:",
        expect.any(Error),
      ),
    );
  });
});
