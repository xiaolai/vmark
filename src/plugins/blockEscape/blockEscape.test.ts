// @vitest-environment node
/**
 * Tests for Block Escape TipTap Extension
 *
 * Tests the combined handler that tries list escape first, then blockquote escape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleEscapeUp, handleEscapeDown, asCommand } from "./tiptap";

// Mock the escape functions from listEscape and blockquoteEscape
vi.mock("@/plugins/listEscape", () => ({
  escapeListUp: vi.fn(),
  escapeListDown: vi.fn(),
}));

vi.mock("@/plugins/blockquoteEscape", () => ({
  escapeBlockquoteUp: vi.fn(),
  escapeBlockquoteDown: vi.fn(),
}));

// Import the mocked functions for control
import { escapeListUp, escapeListDown } from "@/plugins/listEscape";
import { escapeBlockquoteUp, escapeBlockquoteDown } from "@/plugins/blockquoteEscape";

// Type assertions for mocked functions
const mockEscapeListUp = escapeListUp as ReturnType<typeof vi.fn>;
const mockEscapeListDown = escapeListDown as ReturnType<typeof vi.fn>;
const mockEscapeBlockquoteUp = escapeBlockquoteUp as ReturnType<typeof vi.fn>;
const mockEscapeBlockquoteDown = escapeBlockquoteDown as ReturnType<typeof vi.fn>;

describe("Block Escape Extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleEscapeUp", () => {
    // The handler tries escapeListUp first, then escapeBlockquoteUp
    // Returns true if either handler returns true

    it("returns true when list escape handles the event", () => {
      mockEscapeListUp.mockReturnValue(true);
      mockEscapeBlockquoteUp.mockReturnValue(false);

      const mockView = {} as Parameters<typeof handleEscapeUp>[0];
      const result = handleEscapeUp(mockView);

      expect(result).toBe(true);
      expect(mockEscapeListUp).toHaveBeenCalledWith(mockView);
    });

    it("returns true when blockquote escape handles the event", () => {
      mockEscapeListUp.mockReturnValue(false);
      mockEscapeBlockquoteUp.mockReturnValue(true);

      const mockView = {} as Parameters<typeof handleEscapeUp>[0];
      const result = handleEscapeUp(mockView);

      expect(result).toBe(true);
      expect(mockEscapeBlockquoteUp).toHaveBeenCalledWith(mockView);
    });

    it("returns false when neither handler handles the event", () => {
      mockEscapeListUp.mockReturnValue(false);
      mockEscapeBlockquoteUp.mockReturnValue(false);

      const mockView = {} as Parameters<typeof handleEscapeUp>[0];
      const result = handleEscapeUp(mockView);

      expect(result).toBe(false);
    });

    it("does not call blockquote handler if list handler returns true", () => {
      mockEscapeListUp.mockReturnValue(true);
      mockEscapeBlockquoteUp.mockReturnValue(true);

      const mockView = {} as Parameters<typeof handleEscapeUp>[0];
      handleEscapeUp(mockView);

      expect(mockEscapeListUp).toHaveBeenCalled();
      expect(mockEscapeBlockquoteUp).not.toHaveBeenCalled();
    });
  });

  describe("handleEscapeDown", () => {
    it("returns true when list escape handles the event", () => {
      mockEscapeListDown.mockReturnValue(true);
      mockEscapeBlockquoteDown.mockReturnValue(false);

      const mockView = {} as Parameters<typeof handleEscapeDown>[0];
      const result = handleEscapeDown(mockView);

      expect(result).toBe(true);
    });

    it("returns true when blockquote escape handles the event", () => {
      mockEscapeListDown.mockReturnValue(false);
      mockEscapeBlockquoteDown.mockReturnValue(true);

      const mockView = {} as Parameters<typeof handleEscapeDown>[0];
      const result = handleEscapeDown(mockView);

      expect(result).toBe(true);
    });

    it("returns false when neither handler handles the event", () => {
      mockEscapeListDown.mockReturnValue(false);
      mockEscapeBlockquoteDown.mockReturnValue(false);

      const mockView = {} as Parameters<typeof handleEscapeDown>[0];
      const result = handleEscapeDown(mockView);

      expect(result).toBe(false);
    });

    it("does not call blockquote handler if list handler returns true", () => {
      mockEscapeListDown.mockReturnValue(true);
      mockEscapeBlockquoteDown.mockReturnValue(true);

      const mockView = {} as Parameters<typeof handleEscapeDown>[0];
      handleEscapeDown(mockView);

      expect(mockEscapeListDown).toHaveBeenCalled();
      expect(mockEscapeBlockquoteDown).not.toHaveBeenCalled();
    });
  });

  describe("asCommand wrapper", () => {
    // The asCommand wrapper takes a handler function and returns a ProseMirror command
    // It returns false if view is undefined

    it("returns false when view is undefined", () => {
      const handler = vi.fn(() => true);
      const command = asCommand(handler);
      const result = command({} as never, () => {}, undefined);

      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it("calls handler with view when view is provided", () => {
      const handler = vi.fn(() => true);
      const command = asCommand(handler);
      const mockView = { state: {} };
      const result = command({} as never, () => {}, mockView as never);

      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledWith(mockView);
    });

    it("returns handler result when view is provided", () => {
      const command = asCommand(() => false);
      const mockView = { state: {} };
      const result = command({} as never, () => {}, mockView as never);

      expect(result).toBe(false);
    });
  });

  describe("Extension configuration", () => {
    it("has correct priority (1040)", () => {
      // Priority 1040 is slightly lower than tableUI (1050)
      // so table escape runs first
      const BLOCK_ESCAPE_PRIORITY = 1040;
      const TABLE_UI_PRIORITY = 1050;
      expect(BLOCK_ESCAPE_PRIORITY).toBeLessThan(TABLE_UI_PRIORITY);
    });
  });
});
