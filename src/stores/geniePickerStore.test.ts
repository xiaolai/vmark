// @vitest-environment node
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

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("geniePickerStore — T09 revert contract pins", () => {
  beforeEach(() => {
    useGeniePickerStore.getState().closePicker();
  });

  const initialData = {
    isOpen: false,
    filterScope: null,
    mode: "search",
    submittedPrompt: null,
    responseText: "",
    pickerError: null,
  };

  function dataOf(s: ReturnType<typeof useGeniePickerStore.getState>) {
    const { isOpen, filterScope, mode, submittedPrompt, responseText, pickerError } = s;
    return { isOpen, filterScope, mode, submittedPrompt, responseText, pickerError };
  }

  it("no leak across sessions: process in A → close → open B starts fresh", () => {
    useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
    useGeniePickerStore.getState().startProcessing("prompt A");
    useGeniePickerStore.getState().appendResponse("chunk");
    useGeniePickerStore.getState().setPickerError("boom");
    useGeniePickerStore.getState().closePicker();

    useGeniePickerStore.getState().openPicker({ filterScope: "document" });

    expect(dataOf(useGeniePickerStore.getState())).toEqual({
      ...initialData,
      isOpen: true,
      filterScope: "document",
    });
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useGeniePickerStore.getState().openPicker({ filterScope: "block" });
      useGeniePickerStore.getState().startProcessing(`p${i}`);
      useGeniePickerStore.getState().closePicker();
    }
    expect(dataOf(useGeniePickerStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
      useGeniePickerStore.getState().startProcessing("mutate");
      expect(dataOf(useGeniePickerStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
      useGeniePickerStore.setState(useGeniePickerStore.getInitialState());
      expect(dataOf(useGeniePickerStore.getState())).toEqual(initialData);
    });
  });
});
