import { describe, it, expect, beforeEach } from "vitest";
import { useGeniePickerStore } from "../geniePickerStore";

describe("geniePickerStore — mode state machine", () => {
  beforeEach(() => {
    useGeniePickerStore.getState().closePicker();
  });

  it("opens in search mode by default", () => {
    useGeniePickerStore.getState().openPicker();
    const state = useGeniePickerStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.mode).toBe("search");
  });

  it("transitions to processing mode", () => {
    useGeniePickerStore.getState().openPicker();
    useGeniePickerStore.getState().startProcessing("Fix grammar");
    const state = useGeniePickerStore.getState();
    expect(state.mode).toBe("processing");
    expect(state.submittedPrompt).toBe("Fix grammar");
  });

  it("transitions to preview mode with response", () => {
    useGeniePickerStore.getState().openPicker();
    useGeniePickerStore.getState().startProcessing("Fix grammar");
    useGeniePickerStore.getState().setPreview("Fixed text");
    const state = useGeniePickerStore.getState();
    expect(state.mode).toBe("preview");
    expect(state.responseText).toBe("Fixed text");
  });

  it("transitions to error mode", () => {
    useGeniePickerStore.getState().openPicker();
    useGeniePickerStore.getState().startProcessing("Fix grammar");
    useGeniePickerStore.getState().setPickerError("Timeout");
    const state = useGeniePickerStore.getState();
    expect(state.mode).toBe("error");
    expect(state.pickerError).toBe("Timeout");
  });

  it("appendResponse accumulates streaming text", () => {
    useGeniePickerStore.getState().openPicker();
    useGeniePickerStore.getState().startProcessing("Fix grammar");
    useGeniePickerStore.getState().appendResponse("Hello ");
    useGeniePickerStore.getState().appendResponse("world");
    expect(useGeniePickerStore.getState().responseText).toBe("Hello world");
  });

  it("resetToInput returns to search mode", () => {
    useGeniePickerStore.getState().openPicker();
    useGeniePickerStore.getState().startProcessing("Fix grammar");
    useGeniePickerStore.getState().appendResponse("some text");
    useGeniePickerStore.getState().resetToInput();
    const state = useGeniePickerStore.getState();
    expect(state.mode).toBe("search");
    expect(state.submittedPrompt).toBeNull();
    expect(state.responseText).toBe("");
    expect(state.pickerError).toBeNull();
  });

  it("closePicker resets all state", () => {
    useGeniePickerStore.getState().openPicker();
    useGeniePickerStore.getState().startProcessing("Fix grammar");
    useGeniePickerStore.getState().appendResponse("partial");
    useGeniePickerStore.getState().closePicker();
    const state = useGeniePickerStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.mode).toBe("search");
    expect(state.submittedPrompt).toBeNull();
    expect(state.responseText).toBe("");
    expect(state.pickerError).toBeNull();
  });
});
