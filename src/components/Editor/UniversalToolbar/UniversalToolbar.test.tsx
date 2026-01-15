/**
 * UniversalToolbar - Tests
 *
 * TDD tests for the universal bottom toolbar shell (WI-001).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import { UniversalToolbar } from "./UniversalToolbar";

describe("UniversalToolbar", () => {
  beforeEach(() => {
    // Reset store state before each test
    useUIStore.setState({
      universalToolbarVisible: false,
    });
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

  describe("styling", () => {
    it("has correct class name for styling", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);
      expect(screen.getByRole("toolbar")).toHaveClass("universal-toolbar");
    });

    it("has aria-label for accessibility", () => {
      useUIStore.setState({ universalToolbarVisible: true });
      render(<UniversalToolbar />);
      expect(screen.getByRole("toolbar")).toHaveAttribute(
        "aria-label",
        "Formatting toolbar"
      );
    });
  });
});
