// WI-UA13 — welcome front door: identity title, live-binding shortcut hint,
// elevated (1b) action buttons (audit 20260901).
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
    expect(screen.getByRole("button", { name: "Open Workspace…" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Open Workspace…" }));
    expect(mocks.executeCommand).toHaveBeenCalledWith("workspace.openFolder", undefined, {
      windowLabel: "main",
    });
  });

  it("shows one empty-state message when nothing is recent", () => {
    render(<WelcomeScreen />);
    expect(screen.getByText(/Files and workspaces you open will appear here/)).toBeInTheDocument();
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

    expect(screen.queryByText(/Files and workspaces you open will appear here/)).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Open Workspace…" }));

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
    expect(screen.queryByText(/Files and workspaces you open will appear here/)).not.toBeInTheDocument();
  });

  // Each list stands on its own: having files does not imply having workspaces.
  it("omits the workspaces section when only files are recent", () => {
    mocks.recentFiles = [{ path: "/docs/notes.md", name: "notes.md", timestamp: 1 }];
    render(<WelcomeScreen />);

    expect(screen.getByText("Recent Files")).toBeInTheDocument();
    expect(screen.queryByText("Recent Workspaces")).not.toBeInTheDocument();
    expect(screen.queryByText(/Files and workspaces you open will appear here/)).not.toBeInTheDocument();
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

// WI-UI4.7 — the front door says what to do, on canonical buttons.
// WI-UA13 — identity moment + shortcut education (audit 20260901): the h1 is
// the app name at display size, the old instructional sentence survives as a
// tagline, a hint line teaches the REAL bindings, and the actions wear the
// elevated (1b) recipe — the one piece of new design the maintainer ratified.
describe("front door copy and buttons (WI-UI4.7, WI-UA13)", () => {
  it("the h1 is the identity moment; the instructional sentence survives as a tagline", () => {
    render(<WelcomeScreen />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("VMark");
    expect(screen.getByText(/Drop a Markdown file/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Welcome" })).toBeInTheDocument();
  });

  it("teaches the real bindings — command palette and quick open, from the live store", () => {
    const { container } = render(<WelcomeScreen />);
    // jsdom's navigator.platform is "" → non-mac formatting. The audit
    // canvas's ⌘K/⌘P were WRONG (both taken: Link and Print); the hint must
    // quote the shortcuts store, never hardcode a chord.
    const hint = container.querySelector(".welcome-screen__hint");
    expect(hint?.textContent).toContain("Ctrl+Shift+P");
    expect(hint?.textContent).toContain("Command Palette");
    expect(hint?.textContent).toContain("Ctrl+O");
    expect(hint?.textContent).toContain("Quick Open");
  });

  it("all three actions are canonical .vm-btn pills wearing the elevated variant", () => {
    render(<WelcomeScreen />);
    for (const name of ["New File", "Open File", "Open Workspace…"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn.className, name).toContain("vm-btn");
      // Pill shape via the promoted variant (maintainer direction 2026-08-31)
      // — never a per-wrapper radius override, which the shape-drift gate
      // would rightly flag.
      expect(btn.className, name).toContain("vm-btn--pill");
      // The elevated face (WI-UA13) lives on the .vm-btn BASE since WI-UB1 —
      // no variant class to assert; buttonShared pins the recipe itself.
      expect(btn.className, name).not.toContain("vm-btn--elevated");
    }
  });
});
