import { describe, it, expect, beforeEach } from "vitest";
import { useGeniePickerStore } from "./geniePickerStore";

describe("geniePickerStore", () => {
  beforeEach(() => {
    useGeniePickerStore.setState({
      isOpen: false,
      filterScope: null,
    });
  });

  // ── Default state ──────────────────────────────────────────────────

  it("initializes with default state", () => {
    const state = useGeniePickerStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.filterScope).toBeNull();
  });

  // ── openPicker ────────────────────────────────────────────────────

  describe("openPicker", () => {
    it("opens picker without options", () => {
      useGeniePickerStore.getState().openPicker();
      const state = useGeniePickerStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.filterScope).toBeNull();
    });

    it("opens picker with empty options object", () => {
      useGeniePickerStore.getState().openPicker({});
      const state = useGeniePickerStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.filterScope).toBeNull();
    });

    it("opens picker with selection scope filter", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
      const state = useGeniePickerStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.filterScope).toBe("selection");
    });

    it("opens picker with document scope filter", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: "document" });
      expect(useGeniePickerStore.getState().filterScope).toBe("document");
    });

    it("opens picker with block scope filter", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: "block" });
      expect(useGeniePickerStore.getState().filterScope).toBe("block");
    });

    it("overwrites previous scope when opened again", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
      useGeniePickerStore.getState().openPicker({ filterScope: "document" });
      expect(useGeniePickerStore.getState().filterScope).toBe("document");
    });

    it("clears scope when re-opened without options", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
      useGeniePickerStore.getState().openPicker();
      expect(useGeniePickerStore.getState().filterScope).toBeNull();
    });
  });

  // ── closePicker ───────────────────────────────────────────────────

  describe("closePicker", () => {
    it("closes picker and resets state", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
      useGeniePickerStore.getState().closePicker();

      const state = useGeniePickerStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.filterScope).toBeNull();
    });

    it("is idempotent when already closed", () => {
      useGeniePickerStore.getState().closePicker();
      const state = useGeniePickerStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.filterScope).toBeNull();
    });
  });

  // ── setMode ─────────────────────────────────────────────────────────

  describe("setMode", () => {
    it("updates mode to freeform", () => {
      useGeniePickerStore.getState().setMode("freeform");
      expect(useGeniePickerStore.getState().mode).toBe("freeform");
    });

    it("updates mode to processing", () => {
      useGeniePickerStore.getState().setMode("processing");
      expect(useGeniePickerStore.getState().mode).toBe("processing");
    });
  });
});
