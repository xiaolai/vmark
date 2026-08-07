// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { CodeBlockTracker } from "../codeBlockTracker";

describe("CodeBlockTracker", () => {
  let tracker: CodeBlockTracker;

  beforeEach(() => {
    tracker = new CodeBlockTracker();
  });

  describe("processLine", () => {
    it("returns false for a normal text line", () => {
      expect(tracker.processLine("hello world")).toBe(false);
    });

    it("returns true for a backtick fence opening", () => {
      expect(tracker.processLine("```")).toBe(true);
    });

    it("returns true for a tilde fence opening", () => {
      expect(tracker.processLine("~~~")).toBe(true);
    });

    it("returns true for lines inside a fence", () => {
      tracker.processLine("```");
      expect(tracker.processLine("some code")).toBe(true);
    });

    it("returns true for the closing fence line itself", () => {
      tracker.processLine("```");
      expect(tracker.processLine("```")).toBe(true);
    });

    it("returns false for a line after the fence is closed", () => {
      tracker.processLine("```");
      tracker.processLine("code");
      tracker.processLine("```");
      expect(tracker.processLine("normal text")).toBe(false);
    });

    it("does not close fence if different char is used", () => {
      tracker.processLine("```");
      // tilde fence cannot close a backtick fence
      tracker.processLine("~~~");
      expect(tracker.processLine("still inside")).toBe(true);
    });

    it("does not close fence if closing is shorter than opening", () => {
      tracker.processLine("````");
      tracker.processLine("```"); // shorter, not a valid close
      expect(tracker.processLine("still inside")).toBe(true);
    });

    it("closes fence when closing has same or greater length", () => {
      tracker.processLine("```");
      tracker.processLine("`````"); // longer, valid close
      expect(tracker.processLine("outside now")).toBe(false);
    });

    it("does not close fence if rest of line has non-whitespace", () => {
      tracker.processLine("```");
      tracker.processLine("``` some text"); // not a valid close — non-whitespace after
      expect(tracker.processLine("still inside")).toBe(true);
    });

    it("handles up to 3 leading spaces on fence lines", () => {
      expect(tracker.processLine("   ```")).toBe(true);
    });
  });

  describe("isUnclosed", () => {
    it("returns false when no fences have been opened", () => {
      expect(tracker.isUnclosed()).toBe(false);
    });

    it("returns true when a fence is open and not closed", () => {
      tracker.processLine("```");
      expect(tracker.isUnclosed()).toBe(true);
    });

    it("returns false when the fence has been closed", () => {
      tracker.processLine("```");
      tracker.processLine("```");
      expect(tracker.isUnclosed()).toBe(false);
    });
  });

  describe("reset", () => {
    it("resets state so isUnclosed returns false", () => {
      tracker.processLine("```");
      expect(tracker.isUnclosed()).toBe(true);

      tracker.reset();
      expect(tracker.isUnclosed()).toBe(false);
    });

    it("allows reuse after reset", () => {
      tracker.processLine("```");
      tracker.reset();

      // After reset, a new fence can be tracked
      expect(tracker.processLine("normal line")).toBe(false);
      expect(tracker.processLine("~~~")).toBe(true);
      expect(tracker.isUnclosed()).toBe(true);
    });
  });
});
