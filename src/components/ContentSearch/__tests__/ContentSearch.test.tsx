/**
 * ContentSearch component tests — focus trapping.
 *
 * Verifies that Tab/Shift+Tab cycle focus within the dialog
 * rather than escaping to background content (aria-modal semantics).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useContentSearchStore } from "@/stores/contentSearchStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ContentSearch } from "../ContentSearch";

// Mock openFileInNewTabCore and contentSearchNavigation
vi.mock("@/hooks/useFileOpen", () => ({
  openFileInNewTabCore: vi.fn(),
}));
vi.mock("@/hooks/contentSearchNavigation", () => ({
  setPendingContentSearchNav: vi.fn(),
}));

function getFocusableElements() {
  const dialog = screen.getByRole("dialog");
  return dialog.querySelectorAll<HTMLElement>(
    'input, button, [tabindex]:not([tabindex="-1"])'
  );
}

describe("ContentSearch — focus trapping", () => {
  beforeEach(() => {
    useContentSearchStore.setState({
      isOpen: true,
      query: "",
      results: [],
      selectedIndex: 0,
      isSearching: false,
      error: null,
      totalMatches: 0,
      totalFiles: 0,
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      markdownOnly: false,
    });
    useWorkspaceStore.setState({
      rootPath: "/test",
      isWorkspaceMode: true,
    });
  });

  it("Tab on last focusable element wraps to first", () => {
    render(<ContentSearch windowLabel="main" />);

    const focusable = getFocusableElements();
    expect(focusable.length).toBeGreaterThanOrEqual(2);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Focus the last element
    last.focus();
    expect(document.activeElement).toBe(last);

    // Fire Tab keydown — our handler should wrap focus to first
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab on first focusable element wraps to last", () => {
    render(<ContentSearch windowLabel="main" />);

    const focusable = getFocusableElements();
    expect(focusable.length).toBeGreaterThanOrEqual(2);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Focus the first element
    first.focus();
    expect(document.activeElement).toBe(first);

    // Fire Shift+Tab keydown — our handler should wrap focus to last
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("Tab in the middle does not interfere with default behavior", () => {
    render(<ContentSearch windowLabel="main" />);

    const focusable = getFocusableElements();
    expect(focusable.length).toBeGreaterThanOrEqual(3);

    // Focus a middle element
    const middle = focusable[1];
    middle.focus();
    expect(document.activeElement).toBe(middle);

    // Fire Tab keydown — handler should NOT prevent default (focus stays)
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    const prevented = !middle.dispatchEvent(event);
    expect(prevented).toBe(false);
  });
});
