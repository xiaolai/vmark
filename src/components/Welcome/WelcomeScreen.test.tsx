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
}));

vi.mock("@/utils/debug", () => ({ fileOpsError: mocks.fileOpsError }));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

vi.mock("@/hooks/useFileOpen", () => ({
  handleNew: mocks.handleNew,
  handleOpen: mocks.handleOpen,
}));

vi.mock("@/services/commands", () => ({
  executeCommand: mocks.executeCommand,
}));

vi.mock("@/stores/workspaceStore", () => ({
  useRecentFilesStore: (selector: (s: { files: typeof mocks.recentFiles }) => unknown) =>
    selector({ files: mocks.recentFiles }),
}));

describe("WelcomeScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recentFiles = [];
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

  it("shows an empty-state message when there are no recent files", () => {
    render(<WelcomeScreen />);
    expect(screen.getByText("No recent files")).toBeInTheDocument();
  });

  it("renders recent files and opens one on click", async () => {
    mocks.recentFiles = [
      { path: "/docs/notes.md", name: "notes.md", timestamp: 2 },
      { path: "/docs/draft.md", name: "draft.md", timestamp: 1 },
    ];
    const user = userEvent.setup();
    render(<WelcomeScreen />);

    expect(screen.queryByText("No recent files")).not.toBeInTheDocument();

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
