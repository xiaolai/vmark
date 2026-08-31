// WI-3R — rail click performs the full context switch (tests)
// WI-TS5.1 — stable data-rail-action/data-instance-id automation attributes
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { WorkspaceRail, WORKSPACE_RAIL_WIDTH } from "./WorkspaceRail";

const { mockMoveWorkspace, mockDuplicateWorkspace, mockCloseWorkspace, mockToastError, mockToastMessage } = vi.hoisted(() => ({
  mockMoveWorkspace: vi.fn(),
  mockDuplicateWorkspace: vi.fn(),
  mockCloseWorkspace: vi.fn(),
  mockToastError: vi.fn(),
  mockToastMessage: vi.fn(),
}));
vi.mock("@/services/workspaces/closeWorkspaceInstance", () => ({
  closeWorkspaceInstance: mockCloseWorkspace,
}));

vi.mock("@/services/workspaces/workspaceWindowActions", () => ({
  moveWorkspaceInstanceToNewWindow: mockMoveWorkspace,
  duplicateWorkspaceInstanceToNewWindow: mockDuplicateWorkspace,
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: mockToastError, message: mockToastMessage },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

function setRailMode(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
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

function addLooseInstance(windowLabel: string, id = "wsi-loose"): void {
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: null,
      ownerWindowLabel: windowLabel,
      createdFrom: "open",
      kind: "loose",
    }),
  );
}

beforeEach(() => {
  setRailMode(false);
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  mockMoveWorkspace.mockReset();
  mockDuplicateWorkspace.mockReset();
  mockCloseWorkspace.mockReset();
  mockToastError.mockReset();
  mockToastMessage.mockReset();
});

describe("WorkspaceRail", () => {
  it("uses a compact width without changing icon button sizing", () => {
    expect(WORKSPACE_RAIL_WIDTH).toBe(30);
  });

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

  it("renders name-derived glyphs with stable workspace colors", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    // Was `index + 1` ("1", "2") — a POSITIONAL number that changed on reorder
    // and identified nothing. Now the first character of the workspace name.
    const glyphs = [...container.querySelectorAll(".workspace-rail__glyph")].map(
      (glyph) => glyph.textContent,
    );
    const entries = [...container.querySelectorAll<HTMLElement>(".workspace-rail__entry")];
    expect(glyphs).toEqual(["A", "B"]);
    // The colour seeding this test also guarded must survive the change. A
    // `/^var\(--/` match would pass even if BOTH entries got the same token, so
    // assert they are distinct as well as well-formed.
    const colors = entries.map((e) => e.style.getPropertyValue("--workspace-rail-color"));
    for (const color of colors) expect(color).toMatch(/^var\(--[a-z-]+\)$/);
    expect(new Set(colors).size).toBe(2);
  });

  it("keeps glyphs stable when entries are reordered", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
    addInstance("main", "wsi-b", "/Users/xiaolai/beta");

    const { rerender } = render(<WorkspaceRail windowLabel="main" />);
    // Query by accessible name, so the assertion survives a CSS-class rename
    // and states the real contract: THIS workspace shows THIS glyph.
    const glyphOf = (name: string) =>
      screen.getByRole("button", { name: `Activate ${name}` }).textContent;

    expect(glyphOf("alpha")).toBe("A");
    expect(glyphOf("beta")).toBe("B");

    act(() => {
      useWorkspaceInstancesStore
        .getState()
        .reorderWorkspaceInstances("main", ["wsi-b", "wsi-a"]);
    });
    rerender(<WorkspaceRail windowLabel="main" />);

    // A positional index would still read "1","2" after the swap while pointing
    // at different workspaces. Name-derived glyphs travel with their workspace.
    expect(glyphOf("alpha")).toBe("A");
    expect(glyphOf("beta")).toBe("B");
  });

  it("keeps colliding initials at one character each", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
    addInstance("main", "wsi-b", "/Users/xiaolai/apex");

    render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("button", { name: "Activate alpha" })).toHaveTextContent("A");
    expect(screen.getByRole("button", { name: "Activate apex" })).toHaveTextContent("A");
  });

  it("leaves every workspace at one character, colliding or not", () => {
    setRailMode(true);
    addInstance("main", "wsi-z", "/Users/xiaolai/zulu");
    addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
    addInstance("main", "wsi-b", "/Users/xiaolai/apex");

    render(<WorkspaceRail windowLabel="main" />);

    // No glyph is ever lengthened, even when two collide: the full name is
    // already carried by the accessible name, the tooltip and the accent colour.
    expect(screen.getByRole("button", { name: "Activate zulu" })).toHaveTextContent("Z");
    expect(screen.getByRole("button", { name: "Activate alpha" })).toHaveTextContent("A");
    expect(screen.getByRole("button", { name: "Activate apex" })).toHaveTextContent("A");
  });

  it("keeps the full workspace name as the accessible name, not the glyph", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/alpha");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    // Screen readers must announce the workspace, never the one-letter glyph.
    expect(screen.getByRole("button", { name: "Activate alpha" })).toBeInTheDocument();
    expect(container.querySelector(".workspace-rail__glyph")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("renders loose files as a non-folder rail entry", () => {
    setRailMode(true);
    addLooseInstance("main");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    expect(screen.getByRole("button", { name: "Activate Loose Files" }))
      .toBeInTheDocument();
    expect(container.querySelector(".workspace-rail__loose svg")).toBeInTheDocument();
    // Loose Files is not a workspace: it keeps its own icon and must never be
    // given an identity glyph (which would make it read as another workspace).
    expect(container.querySelector(".workspace-rail__glyph")).not.toBeInTheDocument();
  });

  it("performs the FULL context switch on click: activation + outgoing stash (WI-3R)", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const tabId = useTabStore.getState().createTab("main", "/Users/xiaolai/a/doc.md");
    useTabStore.getState().setActiveTab("main", tabId);

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Activate b" }));

    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.activeWorkspaceInstanceId,
    ).toBe("wsi-b");
    // The outgoing instance stashed its live context — the full switch ran,
    // not a raw activation flip.
    const outgoing = useWorkspaceInstancesStore.getState().instances["wsi-a"];
    expect(outgoing.tabIds).toEqual([tabId]);
    expect(outgoing.activeTabId).toBe(tabId);
    // aria-pressed follows the new active instance.
    expect(screen.getByRole("button", { name: "Activate b" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Activate a" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("clicking the ACTIVE entry is a strict no-op", async () => {
    const user = userEvent.setup();
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const before = useWorkspaceInstancesStore.getState().instances;

    render(<WorkspaceRail windowLabel="main" />);
    await user.click(screen.getByRole("button", { name: "Activate a" }));

    expect(useWorkspaceInstancesStore.getState().instances).toEqual(before);
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

  it("does not move when dragend reports the 0,0 cancellation sentinel", () => {
    // A cancelled drag (Esc) or invalid-target drop reports clientX/Y of 0,0
    // in several browsers. The old `<= 0` check treated this as outside and
    // wrongly moved the workspace to a new window.
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");

    render(<WorkspaceRail windowLabel="main" />);
    const button = screen.getByRole("button", { name: "Activate a" });
    const event = createEvent.dragEnd(button);
    Object.defineProperties(event, {
      clientX: { value: 0 },
      clientY: { value: 0 },
    });
    fireEvent(button, event);

    expect(mockMoveWorkspace).not.toHaveBeenCalled();
  });

  it("does not move when dragend reports dropEffect 'none' (cancelled drag)", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");

    render(<WorkspaceRail windowLabel="main" />);
    const button = screen.getByRole("button", { name: "Activate a" });
    const event = createEvent.dragEnd(button);
    Object.defineProperties(event, {
      // Outside coords, but dropEffect "none" means the drag was cancelled.
      clientX: { value: -50 },
      clientY: { value: 20 },
      dataTransfer: { value: { dropEffect: "none" } },
    });
    fireEvent(button, event);

    expect(mockMoveWorkspace).not.toHaveBeenCalled();
  });

  it("does not move to a new window after an internal reorder drop", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");

    render(<WorkspaceRail windowLabel="main" />);
    const source = screen.getByRole("button", { name: "Activate b" });
    const target = screen.getByRole("button", { name: "Activate a" });

    fireEvent.dragStart(source, {
      dataTransfer: { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "wsi-b") },
    });
    fireEvent.dragOver(target);
    fireEvent.drop(target, { dataTransfer: { getData: vi.fn(() => "wsi-b") } });

    // The trailing dragend fires at 0,0 (or outside) after an internal drop;
    // the internal-drop flag must suppress the move.
    const endEvent = createEvent.dragEnd(source);
    Object.defineProperties(endEvent, {
      clientX: { value: -10 },
      clientY: { value: 20 },
    });
    fireEvent(source, endEvent);

    expect(mockMoveWorkspace).not.toHaveBeenCalled();
    // The reorder still happened.
    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.workspaceInstanceIds,
    ).toEqual(["wsi-b", "wsi-a"]);
  });

  it("reorders workspace entries when a rail icon is dropped on another entry", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");

    render(<WorkspaceRail windowLabel="main" />);
    const source = screen.getByRole("button", { name: "Activate b" });
    const target = screen.getByRole("button", { name: "Activate a" });
    fireEvent.dragStart(source, {
      dataTransfer: {
        effectAllowed: "",
        setData: vi.fn(),
        getData: vi.fn(() => "wsi-b"),
      },
    });
    fireEvent.dragOver(target);
    fireEvent.drop(target, {
      dataTransfer: {
        getData: vi.fn(() => "wsi-b"),
      },
    });

    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.workspaceInstanceIds,
    ).toEqual(["wsi-b", "wsi-a"]);
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

  describe("context menu", () => {
    /** Right-click the rail entry for `name` and return its menu. */
    async function openMenu(name: string) {
      const user = userEvent.setup();
      await user.pointer({
        keys: "[MouseRight]",
        target: screen.getByRole("button", { name: `Activate ${name}` }),
      });
      return screen.getByRole("menu");
    }

    it("does not resurrect a stale menu across a rail-mode toggle (R3-11)", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      await openMenu("alpha");
      expect(screen.getByRole("menu")).toBeInTheDocument();

      // Disable the rail with the menu open, then re-enable: the menu's
      // instance may be long gone by the time the rail returns.
      act(() => setRailMode(false));
      expect(screen.queryByRole("menu")).toBeNull();
      act(() => setRailMode(true));

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("opens on right-click with the three workspace actions", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);

      const menu = await openMenu("alpha");

      // Close and Move were previously unreachable from the rail: there was no
      // close affordance at all, and moving required dragging the icon outside
      // the window — undiscoverable and easy to trigger by accident.
      expect(menu).toHaveAccessibleName("alpha");
      expect(screen.getByRole("menuitem", { name: "Close" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Move to New Window" })).toBeInTheDocument();
    });

    it("closes the workspace through the dirty-checked path", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      await openMenu("alpha");

      await userEvent.click(screen.getByRole("menuitem", { name: "Close" }));

      // The tab-closing function is INJECTED: services/ may not import hooks/
      // (ADR-013 tiering), so the component bridges the two tiers.
      expect(mockCloseWorkspace).toHaveBeenCalledWith("main", "wsi-a", {
        closeTabs: expect.any(Function),
      });
    });

    it("duplicates and moves through the existing actions", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);

      await openMenu("alpha");
      await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
      expect(mockDuplicateWorkspace).toHaveBeenCalledWith("main", "wsi-a");

      await openMenu("alpha");
      await userEvent.click(screen.getByRole("menuitem", { name: "Move to New Window" }));
      expect(mockMoveWorkspace).toHaveBeenCalledWith("main", "wsi-a", expect.anything());
    });

    it("focuses the first item and roves with arrow keys", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      await openMenu("alpha");

      // Focus lands on an ITEM, not the container — the container's outline is
      // suppressed, so focusing it would show nothing.
      expect(screen.getByRole("menuitem", { name: "Close" })).toHaveFocus();

      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
      await userEvent.keyboard("{End}");
      expect(screen.getByRole("menuitem", { name: "Move to New Window" })).toHaveFocus();
      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Close" })).toHaveFocus();
    });

    it("returns focus to the rail entry when dismissed", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      const trigger = screen.getByRole("button", { name: "Activate alpha" });
      await openMenu("alpha");

      await userEvent.keyboard("{Escape}");

      // Without this a keyboard user is dumped on <body>, losing their place.
      expect(trigger).toHaveFocus();
    });

    it("dismisses on Escape without running an action", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      render(<WorkspaceRail windowLabel="main" />);
      await openMenu("alpha");

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(mockCloseWorkspace).not.toHaveBeenCalled();
    });

    it("does not activate the workspace when right-clicked", async () => {
      setRailMode(true);
      addInstance("main", "wsi-a", "/Users/xiaolai/alpha");
      addInstance("main", "wsi-b", "/Users/xiaolai/beta");
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-b");
      render(<WorkspaceRail windowLabel="main" />);

      await openMenu("alpha");

      // Opening a menu is not a selection gesture.
      expect(
        useWorkspaceInstancesStore.getState().windows["main"]?.activeWorkspaceInstanceId,
      ).toBe("wsi-b");
    });
  });
});
describe("stable rail automation hooks (WI-TS5.1)", () => {
  it("every rail item carries data-rail-action + data-instance-id (E2E contract)", () => {
    setRailMode(true);
    addInstance("main", "wsi-a", "/Users/xiaolai/a");
    addInstance("main", "wsi-b", "/Users/xiaolai/b");

    const { container } = render(<WorkspaceRail windowLabel="main" />);

    const activate = [...container.querySelectorAll('[data-rail-action="activate"]')];
    expect(activate.map((el) => el.getAttribute("data-instance-id"))).toEqual([
      "wsi-a",
      "wsi-b",
    ]);
    const duplicate = [...container.querySelectorAll('[data-rail-action="duplicate"]')];
    expect(duplicate.map((el) => el.getAttribute("data-instance-id"))).toEqual([
      "wsi-a",
      "wsi-b",
    ]);
  });
});
