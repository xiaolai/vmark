// WI-1.4 — EditorContextMenu renderer: ARIA menu semantics, roving
// keyboard navigation with disabled-skip, submenu open/close, two-step
// Escape, activation routing, dismissal on scroll/resize/blur, and
// shortcut hints honoring custom bindings. WI-4.5 — the dismissal and
// keyboard cases double as the edge-case sweep (blur, scroll, wrap,
// disabled-skip, Home/End).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  runEditorMenuItem: vi.fn(async () => undefined),
  focusEditorSurface: vi.fn(),
  runClipboardCommand: vi.fn(async () => undefined),
}));

vi.mock("./runMenuAction", () => ({ runEditorMenuItem: mocks.runEditorMenuItem }));
vi.mock("./clipboardBridge", () => ({
  focusEditorSurface: mocks.focusEditorSurface,
  runClipboardCommand: mocks.runClipboardCommand,
}));

import { EditorContextMenu } from "./EditorContextMenu";
import { usePopupStore } from "@/stores/popupStore";
import { initialEditorContextMenu } from "@/stores/popupStore/slices";
import { useShortcutsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

function snapshot(overrides: Partial<EditorContextMenuSnapshot> = {}): EditorContextMenuSnapshot {
  return {
    surface: "wysiwyg",
    selectionEmpty: true,
    inCodeBlock: false,
    headingLevel: null,
    listType: null,
    inBlockquote: false,
    link: null,
    formatPolicy: { paragraphFormatting: true, insertBlockActions: true },
    activeActions: [],
    disabledActions: [],
    ...overrides,
  };
}

function openMenu(overrides: Partial<EditorContextMenuSnapshot> = {}) {
  act(() => {
    usePopupStore.getState().editorContextOpenMenu({
      position: { x: 40, y: 60 },
      snapshot: snapshot(overrides),
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePopupStore.setState({ editorContextMenu: initialEditorContextMenu });
  useShortcutsStore.getState().resetAllShortcuts();
});

describe("EditorContextMenu — rendering", () => {
  it("renders nothing while closed", () => {
    render(<EditorContextMenu />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders an ARIA menu with the expected items when opened", () => {
    render(<EditorContextMenu />);
    openMenu();
    expect(screen.getByRole("menu", { name: "Editor actions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Cut/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Paste/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: /Bold/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Heading/ })).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getByRole("menuitem", { name: /Insert Link/ })).toBeInTheDocument();
  });

  it("disables Cut/Copy on empty selection and checks active marks", () => {
    render(<EditorContextMenu />);
    openMenu({ selectionEmpty: true, activeActions: ["bold"] });
    expect(screen.getByRole("menuitem", { name: /Cut/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /^Copy/ })).toBeDisabled();
    expect(screen.getByRole("menuitemcheckbox", { name: /Bold/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("hides formatting sections inside a code block", () => {
    render(<EditorContextMenu />);
    openMenu({ inCodeBlock: true });
    expect(screen.queryByRole("menuitemcheckbox", { name: /Bold/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Heading/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Select All/ })).toBeInTheDocument();
  });

  it("shows the user's custom shortcut binding for items", () => {
    useShortcutsStore.getState().setShortcut("bold", "Alt-Mod-b");
    render(<EditorContextMenu />);
    openMenu();
    const bold = screen.getByRole("menuitemcheckbox", { name: /Bold/ });
    const hint = bold.querySelector(".context-menu-item-shortcut")?.textContent ?? "";
    expect(hint).toContain("B");
    expect(hint).toMatch(/Alt|⌥/);
  });
});

describe("EditorContextMenu — keyboard navigation", () => {
  it("focuses the first enabled item on open (Cut disabled → Paste first)", () => {
    render(<EditorContextMenu />);
    openMenu({ selectionEmpty: true });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Paste/ }));
  });

  it("ArrowDown moves focus, skipping disabled items", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu({ selectionEmpty: false });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Cut/ }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /^Copy/ }));
  });

  it("ArrowRight opens the heading submenu and focuses its first child", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu();
    const heading = screen.getByRole("menuitem", { name: /Heading/ });
    heading.focus();
    fireEvent.mouseEnter(heading);
    // Hover opens without focusing children; ArrowRight moves into it.
    await user.keyboard("{ArrowRight}");
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemcheckbox", { name: /Paragraph/ })
    );
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("menuitemcheckbox", { name: /Paragraph/ })).toBeNull();
  });

  it("Enter activates the focused item and closes the menu", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu({ selectionEmpty: false });
    await user.keyboard("{Enter}");
    expect(mocks.runEditorMenuItem).toHaveBeenCalledWith(
      { type: "clipboard", command: "cut" },
      expect.objectContaining({ surface: "wysiwyg" })
    );
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
  });

  it("Escape is two-step: submenu first, then menu with editor refocus", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu();
    const heading = screen.getByRole("menuitem", { name: /Heading/ });
    heading.focus();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Escape}");
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(true);
    await user.keyboard("{Escape}");
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
    expect(mocks.focusEditorSurface).toHaveBeenCalledWith("wysiwyg");
  });

  it("Tab closes the menu", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu();
    await user.keyboard("{Tab}");
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
  });

  it("Home and End jump to the first and last enabled items", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu({ selectionEmpty: false });
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Insert Link/ }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Cut/ }));
  });

  it("ArrowUp from the first item wraps to the last", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu({ selectionEmpty: false });
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Insert Link/ }));
  });

  it("Enter on a submenu parent opens it; Enter on a child activates it", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu();
    const heading = screen.getByRole("menuitem", { name: /Heading/ });
    heading.focus();
    await user.keyboard("{Enter}");
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemcheckbox", { name: /Paragraph/ })
    );
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(mocks.runEditorMenuItem).toHaveBeenCalledWith(
      { type: "adapter", action: "heading:1" },
      expect.objectContaining({ surface: "wysiwyg" })
    );
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
  });

  it("submenu navigation skips disabled children and supports Home/End", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu({ disabledActions: ["heading:1"] });
    const heading = screen.getByRole("menuitem", { name: /Heading/ });
    heading.focus();
    await user.keyboard("{ArrowRight}");
    // ArrowDown from Paragraph skips disabled Heading 1 → Heading 2
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemcheckbox", { name: /Heading 2/ })
    );
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemcheckbox", { name: /Heading 6/ })
    );
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemcheckbox", { name: /Paragraph/ })
    );
  });

  it("Space activates the focused item", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu();
    const bold = screen.getByRole("menuitemcheckbox", { name: /Bold/ });
    bold.focus();
    await user.keyboard(" ");
    expect(mocks.runEditorMenuItem).toHaveBeenCalledWith(
      { type: "adapter", action: "bold" },
      expect.anything()
    );
  });
});

describe("EditorContextMenu — activation and dismissal", () => {
  it("clicking an item routes through runEditorMenuItem with the snapshot", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu({ surface: "source" });
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Italic/ }));
    expect(mocks.runEditorMenuItem).toHaveBeenCalledWith(
      { type: "adapter", action: "italic" },
      expect.objectContaining({ surface: "source" })
    );
  });

  it("closes on document scroll", () => {
    render(<EditorContextMenu />);
    openMenu();
    fireEvent.scroll(document);
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
  });

  it("closes on window resize and window blur", () => {
    render(<EditorContextMenu />);
    openMenu();
    fireEvent(window, new Event("resize"));
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);

    openMenu();
    fireEvent(window, new Event("blur"));
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
  });

  it("closes on outside mousedown without refocusing the editor", () => {
    render(<EditorContextMenu />);
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
    expect(mocks.focusEditorSurface).not.toHaveBeenCalled();
  });

  it("shifts a bottom-overflowing submenu up to stay inside the window", async () => {
    const user = userEvent.setup();
    render(<EditorContextMenu />);
    openMenu();
    const heading = screen.getByRole("menuitem", { name: /Heading/ });
    // Parent item sits near the window bottom; submenu is 200px tall.
    heading.getBoundingClientRect = () =>
      ({ top: 700, bottom: 724, left: 40, right: 200, width: 160, height: 24 }) as DOMRect;
    const protoRect = HTMLElement.prototype.getBoundingClientRect;
    // Submenu (created on open) reports a 200px-tall rect rendered at
    // top 700 — overflowing the 768px jsdom window; the heading button
    // keeps its instance-level mock above.
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { top: 700, bottom: 900, left: 40, right: 190, width: 150, height: 200 } as DOMRect;
    };
    try {
      heading.focus();
      await user.keyboard("{ArrowRight}");
      const submenu = document.querySelector<HTMLElement>(".editor-context-submenu");
      expect(submenu).not.toBeNull();
      // baseTop = 700; maxBottom = 768 - 10 = 758 →
      // offset = 758 - (700 + 200) = -142.
      expect(submenu?.style.transform).toBe("translateY(-142px)");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = protoRect;
    }
  });

  it("closes when the active tab changes (keyboard tab switch)", () => {
    render(<EditorContextMenu />);
    openMenu();
    act(() => {
      useTabStore.setState((s) => ({
        activeTabId: { ...s.activeTabId, [getCurrentWindowLabel()]: "other-tab" },
      }));
    });
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
  });
});
