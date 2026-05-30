/**
 * Tests for revisionStore (per-tab revisions, WI-0.10)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useRevisionStore, generateRevisionId } from "../documentStore";

const TAB = "tab-1";
const OTHER = "tab-2";

describe("revisionStore", () => {
  beforeEach(() => {
    useRevisionStore.setState({ revisions: {} });
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
    it("updates a tab's revision and returns the new ID", () => {
      const store = useRevisionStore.getState();
      const oldRevision = store.getRevision(TAB);
      const newRevision = store.updateRevision(TAB);

      expect(newRevision).not.toBe(oldRevision);
      expect(useRevisionStore.getState().getRevision(TAB)).toBe(newRevision);
    });

    it("does not affect other tabs", () => {
      const store = useRevisionStore.getState();
      const otherBefore = store.getRevision(OTHER);
      store.updateRevision(TAB);
      expect(useRevisionStore.getState().getRevision(OTHER)).toBe(otherBefore);
    });
  });

  describe("setRevision", () => {
    it("sets a specific revision for a tab", () => {
      useRevisionStore.getState().setRevision(TAB, "rev-custom123");
      expect(useRevisionStore.getState().getRevision(TAB)).toBe("rev-custom123");
    });
  });

  describe("getRevision", () => {
    it("lazily initializes an unknown tab and returns it", () => {
      const rev = useRevisionStore.getState().getRevision(TAB);
      expect(rev).toMatch(/^rev-/);
      // Stable across reads.
      expect(useRevisionStore.getState().getRevision(TAB)).toBe(rev);
    });
  });

  describe("isCurrentRevision", () => {
    it("returns true for the tab's current revision", () => {
      const store = useRevisionStore.getState();
      const rev = store.getRevision(TAB);
      expect(store.isCurrentRevision(TAB, rev)).toBe(true);
    });

    it("returns false for a stale revision", () => {
      const store = useRevisionStore.getState();
      const stale = store.getRevision(TAB);
      store.updateRevision(TAB);
      expect(useRevisionStore.getState().isCurrentRevision(TAB, stale)).toBe(false);
    });

    it("scopes staleness per tab — two tabs at different revisions", () => {
      const store = useRevisionStore.getState();
      store.setRevision(TAB, "rev-AAAAAAAA");
      store.setRevision(OTHER, "rev-BBBBBBBB");
      expect(store.isCurrentRevision(TAB, "rev-AAAAAAAA")).toBe(true);
      expect(store.isCurrentRevision(OTHER, "rev-AAAAAAAA")).toBe(false);
      expect(store.isCurrentRevision(OTHER, "rev-BBBBBBBB")).toBe(true);
    });
  });

  describe("clearRevision", () => {
    it("drops a tab's entry", () => {
      const store = useRevisionStore.getState();
      store.setRevision(TAB, "rev-keepkeep");
      store.clearRevision(TAB);
      expect(TAB in useRevisionStore.getState().revisions).toBe(false);
    });
  });
});
