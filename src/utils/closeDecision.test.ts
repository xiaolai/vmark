/**
 * Unit tests for close decision state machine
 *
 * Validates the 3-way dirty-close decision logic:
 * - Save: save before closing
 * - Discard: close without saving
 * - Cancel: abort the close operation
 */
import { describe, it, expect } from "vitest";
import {
  mapDialogResultToDecision,
  needsDirtyClosePrompt,
  shouldProceedWithClose,
  type CloseDecision,
} from "./closeDecision";

describe("closeDecision", () => {
  describe("mapDialogResultToDecision", () => {
    it("maps true to save", () => {
      expect(mapDialogResultToDecision(true)).toBe("save");
    });

    it("maps false to discard", () => {
      expect(mapDialogResultToDecision(false)).toBe("discard");
    });

    it("maps null (Escape) to cancel", () => {
      expect(mapDialogResultToDecision(null)).toBe("cancel");
    });
  });

  describe("needsDirtyClosePrompt", () => {
    it("returns true when document is dirty", () => {
      expect(needsDirtyClosePrompt(true)).toBe(true);
    });

    it("returns false when document is clean", () => {
      expect(needsDirtyClosePrompt(false)).toBe(false);
    });
  });

  describe("shouldProceedWithClose", () => {
    it("returns false for cancel decision", () => {
      expect(shouldProceedWithClose("cancel")).toBe(false);
    });

    it("returns true for discard decision", () => {
      expect(shouldProceedWithClose("discard")).toBe(true);
    });

    it("returns true for save decision when save succeeded", () => {
      expect(shouldProceedWithClose("save", true)).toBe(true);
    });

    it("returns false for save decision when save failed", () => {
      expect(shouldProceedWithClose("save", false)).toBe(false);
    });

    it("defaults to save succeeded for save decision", () => {
      expect(shouldProceedWithClose("save")).toBe(true);
    });
  });

  describe("decision state machine integration", () => {
    const testCases: Array<{
      name: string;
      dialogResult: boolean | null;
      expectedDecision: CloseDecision;
      saveSucceeded?: boolean;
      shouldClose: boolean;
    }> = [
      {
        name: "User clicks Save and save succeeds",
        dialogResult: true,
        expectedDecision: "save",
        saveSucceeded: true,
        shouldClose: true,
      },
      {
        name: "User clicks Save but save fails",
        dialogResult: true,
        expectedDecision: "save",
        saveSucceeded: false,
        shouldClose: false,
      },
      {
        name: "User clicks Don't Save",
        dialogResult: false,
        expectedDecision: "discard",
        shouldClose: true,
      },
      {
        name: "User presses Escape",
        dialogResult: null,
        expectedDecision: "cancel",
        shouldClose: false,
      },
    ];

    testCases.forEach(({ name, dialogResult, expectedDecision, saveSucceeded, shouldClose }) => {
      it(name, () => {
        const decision = mapDialogResultToDecision(dialogResult);
        expect(decision).toBe(expectedDecision);
        expect(shouldProceedWithClose(decision, saveSucceeded)).toBe(shouldClose);
      });
    });
  });
});
