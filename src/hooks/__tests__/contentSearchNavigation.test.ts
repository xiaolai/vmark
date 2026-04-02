/**
 * Tests for contentSearchNavigation
 *
 * Covers: setPendingContentSearchNav, consumePendingContentSearchNav,
 * and openFindBarWithQuery.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  setPendingContentSearchNav,
  consumePendingContentSearchNav,
  openFindBarWithQuery,
} from "../contentSearchNavigation";
import { useSearchStore } from "@/stores/searchStore";
import { useUIStore } from "@/stores/uiStore";

describe("contentSearchNavigation", () => {
  describe("setPendingContentSearchNav / consumePendingContentSearchNav", () => {
    it("stores and retrieves a pending nav", () => {
      setPendingContentSearchNav("tab-1", 42, "hello");
      const nav = consumePendingContentSearchNav("tab-1");
      expect(nav).toEqual({ line: 42, query: "hello" });
    });

    it("returns undefined on second consume (single use)", () => {
      setPendingContentSearchNav("tab-2", 10, "world");
      consumePendingContentSearchNav("tab-2");
      const second = consumePendingContentSearchNav("tab-2");
      expect(second).toBeUndefined();
    });

    it("returns undefined for unknown tab", () => {
      const nav = consumePendingContentSearchNav("nonexistent");
      expect(nav).toBeUndefined();
    });

    it("handles multiple tabs independently", () => {
      setPendingContentSearchNav("a", 1, "query-a");
      setPendingContentSearchNav("b", 2, "query-b");
      expect(consumePendingContentSearchNav("a")).toEqual({
        line: 1,
        query: "query-a",
      });
      expect(consumePendingContentSearchNav("b")).toEqual({
        line: 2,
        query: "query-b",
      });
    });

    it("overwrites previous pending nav for same tab", () => {
      setPendingContentSearchNav("tab-3", 5, "old");
      setPendingContentSearchNav("tab-3", 10, "new");
      const nav = consumePendingContentSearchNav("tab-3");
      expect(nav).toEqual({ line: 10, query: "new" });
    });
  });

  describe("openFindBarWithQuery", () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: false, query: "" });
      useUIStore.setState({
        statusBarVisible: true,
        universalToolbarVisible: true,
      });
    });

    it("sets query and opens FindBar", () => {
      openFindBarWithQuery("test query");
      expect(useSearchStore.getState().query).toBe("test query");
      expect(useSearchStore.getState().isOpen).toBe(true);
    });

    it("closes StatusBar and UniversalToolbar when opening", () => {
      openFindBarWithQuery("test");

      expect(useUIStore.getState().statusBarVisible).toBe(false);
      expect(useUIStore.getState().universalToolbarVisible).toBe(false);
    });

    it("does not close bars when FindBar is already open", () => {
      useSearchStore.setState({ isOpen: true });
      useUIStore.setState({
        statusBarVisible: true,
        universalToolbarVisible: true,
      });

      openFindBarWithQuery("updated");

      expect(useSearchStore.getState().query).toBe("updated");
      // Bars should remain visible since FindBar was already open
      expect(useUIStore.getState().statusBarVisible).toBe(true);
      expect(useUIStore.getState().universalToolbarVisible).toBe(true);
    });
  });
});
