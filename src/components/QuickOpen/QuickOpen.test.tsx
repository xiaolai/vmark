/**
 * QuickOpen component tests
 *
 * Tests the portal-rendered quick file open overlay:
 * open/close, keyboard navigation, item selection, and browse.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks (before component import) ---

vi.mock("@/components/Sidebar/FileExplorer/useFileTree", () => ({
  useFileTree: vi.fn(() => ({ tree: [], isLoading: false, refresh: vi.fn() })),
}));

const mockOpenFileInNewTabCore = vi.fn();
const mockHandleOpen = vi.fn();
vi.mock("@/hooks/useFileOpen", () => ({
  openFileInNewTabCore: (...args: unknown[]) => mockOpenFileInNewTabCore(...args),
  handleOpen: (...args: unknown[]) => mockHandleOpen(...args),
}));

const mockWorkspaceState = {
  rootPath: null as string | null,
  isWorkspaceMode: false,
  config: null as { excludeFolders?: string[] } | null,
};

const mockRecentFilesState = { files: [] as { path: string; timestamp: number }[], removeFile: vi.fn() };
const mockRecentFilesGetState = vi.fn(() => mockRecentFilesState);
const mockRecentWorkspacesState = { workspaces: [] };

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: Object.assign(
    vi.fn((selector: (s: typeof mockWorkspaceState) => unknown) => {
      return selector ? selector(mockWorkspaceState) : mockWorkspaceState;
    }),
    { getState: () => mockWorkspaceState },
  ),
  useRecentFilesStore: Object.assign(
    vi.fn((selector?: (s: typeof mockRecentFilesState) => unknown) =>
      selector ? selector(mockRecentFilesState) : mockRecentFilesState,
    ),
    { getState: (...args: unknown[]) => mockRecentFilesGetState(...args) },
  ),
  useRecentWorkspacesStore: Object.assign(
    vi.fn((selector?: (s: typeof mockRecentWorkspacesState) => unknown) =>
      selector ? selector(mockRecentWorkspacesState) : mockRecentWorkspacesState,
    ),
    { getState: () => mockRecentWorkspacesState },
  ),
}));

const mockTabsState = { tabs: {} as Record<string, unknown[]>, activeTabId: {} as Record<string, string | null> };
vi.mock("@/stores/tabStore", () => ({
  useTabStore: Object.assign(
    vi.fn((selector?: (s: typeof mockTabsState) => unknown) =>
      selector ? selector(mockTabsState) : mockTabsState,
    ),
    { getState: vi.fn(() => ({ getTabsByWindow: () => [], ...mockTabsState })) },
  ),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

vi.mock("@/hooks/useImeComposition", () => ({
  useImeComposition: vi.fn(() => ({
    isComposing: () => false,
    onCompositionStart: vi.fn(),
    onCompositionEnd: vi.fn(),
  })),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/stores/geniePickerStore", () => ({
  useGeniePickerStore: {
    getState: vi.fn(() => ({ isOpen: false, closePicker: vi.fn() })),
  },
}));

// --- Imports (after mocks) ---

import { useQuickOpenStore } from "./quickOpenStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { QuickOpen } from "./QuickOpen";

// --- Setup ---

// jsdom lacks scrollIntoView
const originalScrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = vi.fn();

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

beforeEach(() => {
  useQuickOpenStore.setState({ isOpen: false });
  mockWorkspaceState.rootPath = null;
  mockWorkspaceState.isWorkspaceMode = false;
  mockWorkspaceState.config = null;
  mockRecentFilesGetState.mockReturnValue({ files: [], removeFile: vi.fn() });
  vi.clearAllMocks();
});

// --- Tests ---

describe("QuickOpen", () => {
  it("renders nothing when store is closed", () => {
    const { container } = render(<QuickOpen windowLabel="main" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders portal with input when store is open", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes GeniePicker when opening", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    expect(useGeniePickerStore.getState).toHaveBeenCalled();
  });

  it("Escape key closes the overlay", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("shows Browse row always", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    expect(screen.getByText("Browse...")).toBeInTheDocument();
  });

  it("shows placeholder for non-workspace mode", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    expect(screen.getByPlaceholderText("Open recent file...")).toBeInTheDocument();
  });

  it("shows workspace placeholder when in workspace mode", () => {
    mockWorkspaceState.rootPath = "/workspace";
    mockWorkspaceState.isWorkspaceMode = true;

    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    expect(screen.getByPlaceholderText("Open file...")).toBeInTheDocument();

    // Restore
    mockWorkspaceState.rootPath = null;
    mockWorkspaceState.isWorkspaceMode = false;
  });

  it("shows 'No files found' when filtering with no matches", async () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const input = screen.getByRole("combobox");
    await userEvent.setup().type(input, "xyz_no_match_123");
    expect(screen.getByText("No files found")).toBeInTheDocument();
  });

  it("Enter on Browse row calls handleOpen when no file items exist", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    // With no recent files / tabs, the only item is Browse (index 0 for rankedItems.length == 0)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(mockHandleOpen).toHaveBeenCalledWith("main");
    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("ArrowDown moves selection (wraps around)", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const dialog = screen.getByRole("dialog");

    // Only Browse row exists (totalCount = 1), so ArrowDown wraps back to 0
    const browseOption = screen.getByText("Browse...").closest("[role='option']");
    expect(browseOption).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    // Wraps: (0 + 1) % 1 = 0 — still Browse
    expect(browseOption).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowUp wraps to last item", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const dialog = screen.getByRole("dialog");

    // selectedIndex starts at 0, ArrowUp: (0 - 1 + 1) % 1 = 0
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    const browseOption = screen.getByText("Browse...").closest("[role='option']");
    expect(browseOption).toHaveAttribute("aria-selected", "true");
  });

  it("click outside closes overlay", () => {
    vi.useFakeTimers();
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);

    // The mousedown listener is installed after setTimeout(0)
    vi.advanceTimersByTime(1);
    fireEvent.mouseDown(document.body);
    expect(useQuickOpenStore.getState().isOpen).toBe(false);
    vi.useRealTimers();
  });

  it("click inside does not close overlay", () => {
    vi.useFakeTimers();
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);

    vi.advanceTimersByTime(1);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(useQuickOpenStore.getState().isOpen).toBe(true);
    vi.useRealTimers();
  });

  it("clicking Browse row calls handleOpen", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const browseRow = screen.getByText("Browse...").closest("[role='option']")!;
    fireEvent.click(browseRow);
    expect(mockHandleOpen).toHaveBeenCalledWith("main");
    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("renders listbox and footer hints", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText(/navigate/)).toBeInTheDocument();
    expect(screen.getByText(/\bopen\b/)).toBeInTheDocument();
    expect(screen.getByText(/\bclose\b/)).toBeInTheDocument();
  });

  it("resets filter and selection when re-opened", async () => {
    const user = userEvent.setup();
    useQuickOpenStore.setState({ isOpen: true });
    const { rerender } = render(<QuickOpen windowLabel="main" />);
    const input = screen.getByRole("combobox");
    await user.type(input, "test");
    expect(input).toHaveValue("test");

    // Close via store, re-render to reflect closed state
    act(() => useQuickOpenStore.setState({ isOpen: false }));
    rerender(<QuickOpen windowLabel="main" />);

    // Reopen
    act(() => useQuickOpenStore.setState({ isOpen: true }));
    rerender(<QuickOpen windowLabel="main" />);
    expect(screen.getByRole("combobox")).toHaveValue("");
  });
});

describe("QuickOpen with file items", () => {
  beforeEach(() => {
    mockRecentFilesGetState.mockReturnValue({
      files: [
        { path: "/docs/readme.md", timestamp: Date.now() },
        { path: "/docs/notes.md", timestamp: Date.now() - 1000 },
      ],
      removeFile: vi.fn(),
    });
  });

  it("renders file items from recent files", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });

  it("Enter on file item calls openFileInNewTabCore", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    // First item is selected by default (index 0 = readme.md)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/docs/readme.md");
    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("ArrowDown then Enter selects second file", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/docs/notes.md");
  });

  it("clicking a file item calls openFileInNewTabCore", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const fileRow = screen.getByText("notes.md").closest("[role='option']")!;
    fireEvent.click(fileRow);
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/docs/notes.md");
  });

  it("ArrowDown past last file selects Browse", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const dialog = screen.getByRole("dialog");

    // 2 files + Browse = 3 items. Start at 0, press Down twice to reach Browse (index 2)
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(mockHandleOpen).toHaveBeenCalledWith("main");
  });

  it("filtering narrows results", async () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const input = screen.getByRole("combobox");
    await userEvent.setup().type(input, "read");
    // renderHighlighted splits text into individual spans, so use option role count
    const options = screen.getAllByRole("option");
    // Should have 1 matching file + Browse = 2 options
    expect(options).toHaveLength(2);
    // notes.md should not appear (no match for "read")
    expect(screen.queryByText("notes.md")).not.toBeInTheDocument();
  });

  it("mouseEnter on item changes selection", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const secondItem = screen.getByText("notes.md").closest("[role='option']")!;
    fireEvent.mouseEnter(secondItem);
    expect(secondItem).toHaveAttribute("aria-selected", "true");
  });

  it("clamps selectedIndex when results shrink after filtering", async () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const dialog = screen.getByRole("dialog");

    // Move to last file item (index 1 = notes.md)
    fireEvent.keyDown(dialog, { key: "ArrowDown" });

    // Type a filter that removes notes.md — only readme.md matches
    const input = screen.getByRole("combobox");
    await userEvent.setup().type(input, "read");

    // Selection should clamp — Browse row (index 1) or readme.md (index 0) should be selected
    const options = screen.getAllByRole("option");
    const anySelected = options.some((o) => o.getAttribute("aria-selected") === "true");
    expect(anySelected).toBe(true);
  });

  it("mouseEnter on Browse row selects it", () => {
    useQuickOpenStore.setState({ isOpen: true });
    render(<QuickOpen windowLabel="main" />);
    const browseRow = screen.getByText("Browse...").closest("[role='option']")!;
    fireEvent.mouseEnter(browseRow);
    expect(browseRow).toHaveAttribute("aria-selected", "true");
  });

  it("clamps selectedIndex when filter shrinks results below current index", async () => {
    useQuickOpenStore.setState({ isOpen: true });
    const { rerender } = render(<QuickOpen windowLabel="main" />);
    const dialog = screen.getByRole("dialog");

    // Move selection to Browse row (index 2 — last of 3 items)
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    const browseRow = screen.getByText("Browse...").closest("[role='option']")!;
    expect(browseRow).toHaveAttribute("aria-selected", "true");

    // Type filter that leaves only 1 file match + Browse = 2 items (indices 0-1)
    // selectedIndex is 2 which is >= totalCount(2), so clamp effect fires
    const input = screen.getByRole("combobox");
    await userEvent.setup().type(input, "read");

    // Wait for the clamp useEffect to run
    await act(async () => {
      rerender(<QuickOpen windowLabel="main" />);
    });

    // After clamping, some option should be selected (index clamped to 1 = Browse)
    const options = screen.getAllByRole("option");
    const selectedOption = options.find((o) => o.getAttribute("aria-selected") === "true");
    expect(selectedOption).toBeDefined();
  });

  it("restores focus to previously focused element on close", () => {
    // Create and focus a button to simulate prior focus
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    useQuickOpenStore.setState({ isOpen: true });
    const { rerender } = render(<QuickOpen windowLabel="main" />);

    // Close
    act(() => useQuickOpenStore.setState({ isOpen: false }));
    rerender(<QuickOpen windowLabel="main" />);

    expect(document.activeElement).toBe(button);
    document.body.removeChild(button);
  });
});
