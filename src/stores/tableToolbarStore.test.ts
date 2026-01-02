import { describe, it, expect, beforeEach } from "vitest";
import { useTableToolbarStore } from "./tableToolbarStore";

describe("tableToolbarStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useTableToolbarStore.getState().closeToolbar();
  });

  describe("initial state", () => {
    it("starts closed with no position", () => {
      const state = useTableToolbarStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.tablePos).toBe(0);
      expect(state.anchorRect).toBeNull();
    });
  });

  describe("openToolbar", () => {
    it("opens toolbar with provided data", () => {
      const { openToolbar } = useTableToolbarStore.getState();

      openToolbar({
        tablePos: 42,
        anchorRect: { top: 100, left: 200, bottom: 150, right: 400 },
      });

      const state = useTableToolbarStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.tablePos).toBe(42);
      expect(state.anchorRect).toEqual({
        top: 100,
        left: 200,
        bottom: 150,
        right: 400,
      });
    });
  });

  describe("closeToolbar", () => {
    it("resets all state to initial values", () => {
      const store = useTableToolbarStore.getState();

      // First open
      store.openToolbar({
        tablePos: 100,
        anchorRect: { top: 10, left: 20, bottom: 30, right: 40 },
      });

      // Then close
      store.closeToolbar();

      const state = useTableToolbarStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.tablePos).toBe(0);
      expect(state.anchorRect).toBeNull();
    });
  });

  describe("updatePosition", () => {
    it("updates anchorRect without changing other state", () => {
      const store = useTableToolbarStore.getState();

      // Open first
      store.openToolbar({
        tablePos: 50,
        anchorRect: { top: 10, left: 20, bottom: 30, right: 40 },
      });

      // Update position
      store.updatePosition({ top: 100, left: 200, bottom: 150, right: 400 });

      const state = useTableToolbarStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.tablePos).toBe(50); // Unchanged
      expect(state.anchorRect).toEqual({
        top: 100,
        left: 200,
        bottom: 150,
        right: 400,
      });
    });
  });
});
