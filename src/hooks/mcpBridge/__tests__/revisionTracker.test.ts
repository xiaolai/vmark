/**
 * Tests for revisionTracker — validateBaseRevision, getCurrentRevision,
 * isValidRevision with real revision store (no mocks).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useRevisionStore } from "@/stores/revisionStore";
import {
  validateBaseRevision,
  getCurrentRevision,
  isValidRevision,
} from "../revisionTracker";

describe("revisionTracker", () => {
  beforeEach(() => {
    useRevisionStore.getState().setRevision("rev-test1234");
  });

  describe("validateBaseRevision", () => {
    it("returns error when baseRevision is undefined", () => {
      const result = validateBaseRevision(undefined);
      expect(result).not.toBeNull();
      expect(result!.error).toBe("baseRevision is required for mutations");
      expect(result!.currentRevision).toBe("rev-test1234");
    });

    it("returns error when baseRevision is empty string", () => {
      const result = validateBaseRevision("");
      expect(result).not.toBeNull();
      expect(result!.error).toBe("baseRevision is required for mutations");
    });

    it("returns error when baseRevision is stale", () => {
      const result = validateBaseRevision("rev-oldstale");
      expect(result).not.toBeNull();
      expect(result!.error).toContain("Revision conflict");
      expect(result!.error).toContain("rev-oldstale");
      expect(result!.error).toContain("rev-test1234");
      expect(result!.currentRevision).toBe("rev-test1234");
    });

    it("returns null when baseRevision matches current", () => {
      const result = validateBaseRevision("rev-test1234");
      expect(result).toBeNull();
    });

    it("detects revision change after updateRevision", () => {
      const oldRevision = "rev-test1234";
      useRevisionStore.getState().updateRevision();
      const result = validateBaseRevision(oldRevision);
      expect(result).not.toBeNull();
      expect(result!.error).toContain("Revision conflict");
    });

    it("accepts new revision after updateRevision", () => {
      const newRev = useRevisionStore.getState().updateRevision();
      const result = validateBaseRevision(newRev);
      expect(result).toBeNull();
    });
  });

  describe("getCurrentRevision", () => {
    it("returns the current revision from the store", () => {
      expect(getCurrentRevision()).toBe("rev-test1234");
    });

    it("reflects updates to the store", () => {
      const newRev = useRevisionStore.getState().updateRevision();
      expect(getCurrentRevision()).toBe(newRev);
    });
  });

  describe("isValidRevision", () => {
    it("returns true for matching revision", () => {
      expect(isValidRevision("rev-test1234")).toBe(true);
    });

    it("returns false for non-matching revision", () => {
      expect(isValidRevision("rev-different")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isValidRevision("")).toBe(false);
    });
  });
});
