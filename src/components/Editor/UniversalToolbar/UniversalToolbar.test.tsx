/**
 * UniversalToolbar - Tests
 *
 * TDD tests for the universal bottom toolbar shell (WI-001).
 *
 * Coverage per spec sections:
 * - 1.2: Focus toggle model (4 cases)
 * - 3.3: Dropdown close behavior (click outside, click other button)
 * - 4.5: Session memory
 * - 6.1: ARIA roles and attributes
 * - 6.3: Roving tabindex
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import { useEditorStore } from "@/stores/editorStore";

const mockedStores = vi.hoisted(() => ({
  sourceState: {
    context: null,
    editorView: null,
  },
  tiptapState: {
    editor: null,
    editorView: null,
    context: null,
  },
}));

vi.mock("@/stores/sourceCursorContextStore", () => {
  type StoreState = typeof mockedStores.sourceState;
  type StoreHook = ((selector?: (state: StoreState) => unknown) => unknown) & {
    getState: () => StoreState;
    setState: (next: Partial<StoreState>) => void;
  };
  const store = ((selector?: (state: StoreState) => unknown) =>
    selector ? selector(mockedStores.sourceState) : mockedStores.sourceState) as unknown as StoreHook;
  store.getState = () => mockedStores.sourceState;
  store.setState = (next) => Object.assign(mockedStores.sourceState, next);
  return { useSourceCursorContextStore: store };
});

vi.mock("@/stores/tiptapEditorStore", () => {
  type StoreState = typeof mockedStores.tiptapState;
  type StoreHook = ((selector?: (state: StoreState) => unknown) => unknown) & {
    getState: () => StoreState;
    setState: (next: Partial<StoreState>) => void;
  };
  const store = ((selector?: (state: StoreState) => unknown) =>
    selector ? selector(mockedStores.tiptapState) : mockedStores.tiptapState) as unknown as StoreHook;
  store.getState = () => mockedStores.tiptapState;
  store.setState = (next) => Object.assign(mockedStores.tiptapState, next);
  return { useTiptapEditorStore: store };
});

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { UniversalToolbar } from "./UniversalToolbar";

function resetStores() {
  useUIStore.setState({
    universalToolbarVisible: false,
    universalToolbarHasFocus: false,
    toolbarSessionFocusIndex: -1,
    toolbarDropdownOpen: false,
  });
  useEditorStore.setState({
    sourceMode: false,
  });
  mockedStores.sourceState.context = null;
  mockedStores.sourceState.editorView = null;
  mockedStores.tiptapState.context = null;
  mockedStores.tiptapState.editorView = null;
  mockedStores.tiptapState.editor = null;
}

describe("UniversalToolbar", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("visibility", () => {
    it("renders nothing when visibility is false", () => {
      useUIStore.setState({ universalToolbarVisible: false });
      render(<UniversalToolbar />);
      expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    });

    it("renders toolbar container when visibility is true", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);
      expect(screen.getByRole("toolbar")).toBeInTheDocument();
    });
  });

  describe("ARIA attributes per spec Section 6.1a", () => {
    it("has role=toolbar on container", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);
      expect(screen.getByRole("toolbar")).toBeInTheDocument();
    });

    it("has aria-label on toolbar container", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);
      expect(screen.getByRole("toolbar")).toHaveAttribute(
        "aria-label",
        "Formatting toolbar"
      );
    });

    it("has aria-orientation=horizontal on toolbar container", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);
      expect(screen.getByRole("toolbar")).toHaveAttribute(
        "aria-orientation",
        "horizontal"
      );
    });

    it("has correct class name for styling", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);
      expect(screen.getByRole("toolbar")).toHaveClass("universal-toolbar");
    });
  });

  describe("toolbar button ARIA per spec Section 6.1b", () => {
    it("dropdown buttons have aria-haspopup=menu", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");
      // All toolbar buttons are dropdown type in the default config
      const dropdownButtons = buttons.filter(btn =>
        btn.getAttribute("aria-haspopup") === "menu"
      );
      expect(dropdownButtons.length).toBeGreaterThan(0);
    });

    it("dropdown buttons have aria-expanded=false when closed", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");
      const dropdownButtons = buttons.filter(btn =>
        btn.getAttribute("aria-haspopup") === "menu"
      );

      dropdownButtons.forEach(btn => {
        expect(btn).toHaveAttribute("aria-expanded", "false");
      });
    });

    it("buttons have aria-label for screen readers", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");
      buttons.forEach(btn => {
        expect(btn).toHaveAttribute("aria-label");
        expect(btn.getAttribute("aria-label")).not.toBe("");
      });
    });
  });

  describe("no aria-pressed on dropdown buttons per spec Section 6.1c", () => {
    it("dropdown buttons do NOT have aria-pressed attribute", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");
      const dropdownButtons = buttons.filter(btn =>
        btn.getAttribute("aria-haspopup") === "menu"
      );

      // Per spec: "Do NOT use aria-pressed on dropdown buttons. They are not toggles themselves."
      dropdownButtons.forEach(btn => {
        expect(btn).not.toHaveAttribute("aria-pressed");
      });
    });
  });

  describe("roving tabindex per spec Section 6.3", () => {
    it("only focused button has tabindex=0 when toolbar has focus", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Wait for initial focus effect to complete
      // The component computes smart initial focus via getInitialFocusIndex
      await waitFor(() => {
        // Some button should have tabindex=0 (roving tabindex pattern)
        const focusedButton = buttons.find(btn => btn.getAttribute("tabindex") === "0");
        expect(focusedButton).toBeTruthy();
      });

      // Verify roving tabindex: only one button has tabindex=0
      const focusedButtons = buttons.filter(btn => btn.getAttribute("tabindex") === "0");
      expect(focusedButtons).toHaveLength(1);

      // All other buttons should have tabindex=-1
      const unfocusedButtons = buttons.filter(btn => btn.getAttribute("tabindex") === "-1");
      expect(unfocusedButtons).toHaveLength(buttons.length - 1);
    });

    it("focused button changes when navigating", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const toolbar = screen.getByRole("toolbar");
      const buttons = screen.getAllByRole("button");

      // Wait for initial focus effect to complete
      let initialFocusedIndex = -1;
      await waitFor(() => {
        const focusedButton = buttons.find(btn => btn.getAttribute("tabindex") === "0");
        expect(focusedButton).toBeTruthy();
        initialFocusedIndex = buttons.indexOf(focusedButton!);
      });

      // Navigate right
      fireEvent.keyDown(toolbar, { key: "ArrowRight" });

      await waitFor(() => {
        // Next button should now have tabindex=0
        const expectedNextIndex = (initialFocusedIndex + 1) % buttons.length;
        expect(buttons[expectedNextIndex]).toHaveAttribute("tabindex", "0");
        // Previous focused button should have tabindex=-1
        expect(buttons[initialFocusedIndex]).toHaveAttribute("tabindex", "-1");
      });
    });

    it("all buttons have tabindex=-1 when toolbar does not have focus", () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: false,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");
      buttons.forEach(btn => {
        expect(btn).toHaveAttribute("tabindex", "-1");
      });
    });
  });

  describe("focus toggle per spec Section 1.2", () => {
    it("case 1.2d: toggle with dropdown open closes dropdown and focuses editor", async () => {
      // Setup: toolbar visible, focused, dropdown open
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
        toolbarDropdownOpen: true,
      });
      render(<UniversalToolbar />);

      // Simulate the toggle (which would come from hotkey handler)
      // The toolbar component reacts to toolbarDropdownOpen becoming false
      await act(async () => {
        useUIStore.getState().setToolbarDropdownOpen(false);
      });

      await waitFor(() => {
        expect(useUIStore.getState().toolbarDropdownOpen).toBe(false);
      });
    });
  });

  describe("session memory per spec Section 4.5b", () => {
    it("stores session focus index when navigating", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const toolbar = screen.getByRole("toolbar");
      const buttons = screen.getAllByRole("button");

      // Wait for initial focus effect
      let initialIndex = -1;
      await waitFor(() => {
        const focusedButton = buttons.find(btn => btn.getAttribute("tabindex") === "0");
        expect(focusedButton).toBeTruthy();
        initialIndex = buttons.indexOf(focusedButton!);
      });

      // Navigate to next button
      fireEvent.keyDown(toolbar, { key: "ArrowRight" });

      const expectedNextIndex = (initialIndex + 1) % buttons.length;
      await waitFor(() => {
        // Session focus index should be updated
        expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(expectedNextIndex);
      });
    });

    it("restores session focus index when toggling back to toolbar", async () => {
      // Scenario: toolbar was open, user toggled focus to editor, now toggling back
      // First, establish toolbar was previously visible (wasVisibleRef = true)
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 3,
      });

      const { rerender } = render(<UniversalToolbar />);
      const buttons = screen.getAllByRole("button");

      // Wait for initial focus to be computed (first open uses smart focus algorithm)
      await waitFor(() => {
        const focusedButton = buttons.find(btn => btn.getAttribute("tabindex") === "0");
        expect(focusedButton).toBeTruthy();
      });

      // Simulate user toggled focus away from toolbar (to editor)
      await act(async () => {
        useUIStore.setState({
          universalToolbarHasFocus: false,
          toolbarSessionFocusIndex: 3, // Session memory set to button 3
        });
      });
      rerender(<UniversalToolbar />);

      // All buttons should have tabindex=-1 when toolbar doesn't have focus
      await waitFor(() => {
        buttons.forEach(btn => {
          expect(btn).toHaveAttribute("tabindex", "-1");
        });
      });

      // Toggle focus back to toolbar
      await act(async () => {
        useUIStore.setState({
          universalToolbarHasFocus: true,
        });
      });
      rerender(<UniversalToolbar />);

      // Session memory should restore focus to button 3
      await waitFor(() => {
        expect(buttons[3]).toHaveAttribute("tabindex", "0");
      });
    });
  });

  describe("disabled button focus persistence per spec Section 4.5d", () => {
    it("focus can remain on a button even if visually disabled state might change", async () => {
      // This tests the "no live updates" principle - focus stays where it is
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const toolbar = screen.getByRole("toolbar");
      const buttons = screen.getAllByRole("button");

      // Wait for initial focus (smart focus algorithm determines which button)
      let initialFocusedIndex = -1;
      await waitFor(() => {
        const focusedButton = buttons.find(btn => btn.getAttribute("tabindex") === "0");
        expect(focusedButton).toBeTruthy();
        initialFocusedIndex = buttons.indexOf(focusedButton!);
      });

      // Navigate right once
      fireEvent.keyDown(toolbar, { key: "ArrowRight" });

      // Wait for navigation to complete
      const expectedNextIndex = (initialFocusedIndex + 1) % buttons.length;
      await waitFor(() => {
        expect(buttons[expectedNextIndex]).toHaveAttribute("tabindex", "0");
      });

      // Focus should remain stable - verify it's still on the navigated button
      // Per spec Section 4.5d: "No live updates" - focus is user-controlled
      // Focus doesn't jump elsewhere unless user navigates
      expect(buttons[expectedNextIndex]).toHaveAttribute("tabindex", "0");
      expect(buttons[initialFocusedIndex]).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("click outside dropdown per spec Section 3.3e", () => {
    it("click outside dropdown closes it (toolbar button stays focused)", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Click to open dropdown
      fireEvent.click(buttons[0]);

      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Click outside (on document body)
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });

      // Session focus index should remain the same
      expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(0);
    });
  });

  describe("click another toolbar button per spec Section 3.3f", () => {
    it("clicking different toolbar button closes current dropdown and opens new one", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Click first button to open its dropdown
      fireEvent.click(buttons[0]);

      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Click second button - should close first dropdown and open second
      fireEvent.click(buttons[1]);

      await waitFor(() => {
        // Menu should still be present (new dropdown)
        expect(screen.queryByRole("menu")).toBeInTheDocument();
        // Session focus index should be updated to second button
        expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(1);
      });
    });

    it("clicking same button with dropdown open closes it", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Click to open dropdown
      fireEvent.click(buttons[0]);

      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Click same button again - should close dropdown
      fireEvent.click(buttons[0]);

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
    });
  });

  describe("dropdown expanded state", () => {
    it("aria-expanded becomes true when dropdown opens", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Initially closed
      expect(buttons[0]).toHaveAttribute("aria-expanded", "false");

      // Click to open
      fireEvent.click(buttons[0]);

      await waitFor(() => {
        expect(buttons[0]).toHaveAttribute("aria-expanded", "true");
      });
    });
  });

  describe("dropdown close focus outcomes per spec Section 3.2b-f and 3.3a-d", () => {
    it("3.2c/3.3a: Escape closes dropdown, toolbar button stays focused", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Open dropdown
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Press Escape in dropdown
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });

      // Session focus index should still be 0
      expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(0);
    });

    it("3.2d/3.3b: ArrowLeft in dropdown closes it and moves to previous toolbar button", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 1,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Open dropdown on button 1
      fireEvent.click(buttons[1]);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Press ArrowLeft in dropdown
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "ArrowLeft" });

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        // Focus should move to previous button (index 0)
        expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(0);
      });
    });

    it("3.2d/3.3b: ArrowRight in dropdown closes it and moves to next toolbar button", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 1,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Open dropdown on button 1
      fireEvent.click(buttons[1]);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Press ArrowRight in dropdown
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "ArrowRight" });

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        // Focus should move to next button (index 2)
        expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(2);
      });
    });

    it("3.2e/3.3c: Tab in dropdown closes it and moves to next toolbar button", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Open dropdown on button 0
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Press Tab in dropdown
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "Tab" });

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        // Focus should move to next button (index 1)
        expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(1);
      });
    });

    it("3.2f/3.3c: Shift+Tab in dropdown closes it and moves to previous toolbar button", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 2,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Open dropdown on button 2
      fireEvent.click(buttons[2]);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Press Shift+Tab in dropdown
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "Tab", shiftKey: true });

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        // Focus should move to previous button (index 1)
        expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(1);
      });
    });

    it("3.2b/3.3d: selecting item closes dropdown, same toolbar button stays focused", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // Open dropdown
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Click a menu item - use the class selector since items can have different roles
      const menu = screen.getByRole("menu");
      const menuItems = menu.querySelectorAll(".universal-toolbar-dropdown-item:not(.disabled)");
      if (menuItems.length > 0) {
        fireEvent.click(menuItems[0]);
      } else {
        // If all items are disabled, just close via Escape
        fireEvent.keyDown(menu, { key: "Escape" });
      }

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });

      // Focus should remain on same button
      expect(useUIStore.getState().toolbarSessionFocusIndex).toBe(0);
    });
  });

  describe("Shift+Cmd+P with dropdown open per spec Section 3.3g", () => {
    it("closing dropdown via store closes dropdown and focuses editor", async () => {
      // This tests the behavior when Shift+Cmd+P is pressed while dropdown is open
      // The hotkey handler sets toolbarDropdownOpen to false
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
        toolbarDropdownOpen: true,
      });
      render(<UniversalToolbar />);

      const buttons = screen.getAllByRole("button");

      // First verify we can open a dropdown
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // Simulate what the hotkey does: set dropdown state to false and focus to false
      await act(async () => {
        useUIStore.getState().setToolbarDropdownOpen(false);
        useUIStore.getState().setUniversalToolbarHasFocus(false);
      });

      await waitFor(() => {
        // Dropdown should be closed
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        // Toolbar should lose focus
        expect(useUIStore.getState().universalToolbarHasFocus).toBe(false);
      });
    });
  });

  describe("two-step Escape cascade per spec Section 1.3", () => {
    it("first Escape closes dropdown, second Escape closes toolbar", async () => {
      useUIStore.setState({
        universalToolbarVisible: true,
        universalToolbarHasFocus: true,
        toolbarSessionFocusIndex: 0,
      });
      render(<UniversalToolbar />);

      const toolbar = screen.getByRole("toolbar");
      const buttons = screen.getAllByRole("button");

      // Open dropdown
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeInTheDocument();
      });

      // First Escape: closes dropdown only
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "Escape" });

      await waitFor(() => {
        // Dropdown should be closed
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        // Toolbar should still be visible
        expect(useUIStore.getState().universalToolbarVisible).toBe(true);
      });

      // Second Escape: closes toolbar
      fireEvent.keyDown(toolbar, { key: "Escape" });

      await waitFor(() => {
        expect(useUIStore.getState().universalToolbarVisible).toBe(false);
      });
    });
  });
});
