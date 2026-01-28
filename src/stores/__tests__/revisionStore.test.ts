/**
 * Tests for revisionStore
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useRevisionStore, generateRevisionId } from "../revisionStore";

describe("revisionStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useRevisionStore.setState({
      currentRevision: generateRevisionId(),
      lastUpdated: Date.now(),
    });
  });

  describe("generateRevisionId", () => {
    it("generates unique revision IDs", () => {
      const id1 = generateRevisionId();
      const id2 = generateRevisionId();
      expect(id1).not.toBe(id2);
    });

    it("generates IDs with correct prefix", () => {
      const id = generateRevisionId();
      expect(id).toMatch(/^rev-[a-zA-Z0-9_-]{8}$/);
    });
  });

  describe("updateRevision", () => {
    it("updates revision and returns new ID", () => {
      const store = useRevisionStore.getState();
      const oldRevision = store.currentRevision;

      const newRevision = store.updateRevision();

      expect(newRevision).not.toBe(oldRevision);
      expect(useRevisionStore.getState().currentRevision).toBe(newRevision);
    });

    it("updates lastUpdated timestamp", () => {
      const beforeUpdate = Date.now();
      useRevisionStore.getState().updateRevision();
      const afterUpdate = Date.now();

      const { lastUpdated } = useRevisionStore.getState();
      expect(lastUpdated).toBeGreaterThanOrEqual(beforeUpdate);
      expect(lastUpdated).toBeLessThanOrEqual(afterUpdate);
    });
  });

  describe("setRevision", () => {
    it("sets specific revision", () => {
      const customRevision = "rev-custom123";
      useRevisionStore.getState().setRevision(customRevision);

      expect(useRevisionStore.getState().currentRevision).toBe(customRevision);
    });
  });

  describe("getRevision", () => {
    it("returns current revision", () => {
      const { currentRevision, getRevision } = useRevisionStore.getState();
      expect(getRevision()).toBe(currentRevision);
    });
  });

  describe("isCurrentRevision", () => {
    it("returns true for current revision", () => {
      const { currentRevision, isCurrentRevision } = useRevisionStore.getState();
      expect(isCurrentRevision(currentRevision)).toBe(true);
    });

    it("returns false for stale revision", () => {
      const { currentRevision, updateRevision } = useRevisionStore.getState();
      const staleRevision = currentRevision;

      updateRevision();

      expect(useRevisionStore.getState().isCurrentRevision(staleRevision)).toBe(false);
    });
  });
});
