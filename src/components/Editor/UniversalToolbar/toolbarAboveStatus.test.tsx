/**
 * The toolbar reserves the status-bar strip so document tabs stay clickable.
 *
 * The shell test file is frozen by the file-size baseline, so the class
 * that pushes the toolbar above that strip lives here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import { UniversalToolbar } from "./UniversalToolbar";

describe("UniversalToolbar above the status bar", () => {
  beforeEach(() => {
    useUIStore.setState({
      universalToolbarVisible: false,
      universalToolbarHasFocus: false,
      toolbarSessionFocusIndex: -1,
      toolbarDropdownOpen: false,
      sourceMode: false,
    });
  });

  it("reserves the status-bar strip so the toolbar does not cover the tabs", () => {
    useUIStore.setState({ universalToolbarVisible: true, statusBarVisible: true });
    render(<UniversalToolbar />);
    expect(screen.getByRole("toolbar")).toHaveClass("universal-toolbar--above-status");
  });

  it("sits on the bottom edge when the status bar is hidden", () => {
    useUIStore.setState({ universalToolbarVisible: true, statusBarVisible: false });
    render(<UniversalToolbar />);
    expect(screen.getByRole("toolbar")).not.toHaveClass("universal-toolbar--above-status");
  });
});
