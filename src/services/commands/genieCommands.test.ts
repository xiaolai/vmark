/**
 * Tests for genieCommands: detectScope's four-branch return shape and the
 * genies.togglePicker / genies.openPicker command registration + behavior.
 * (Keybinding Phase 3 — migrated from useGenieShortcuts.)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks — must precede the SUT import.
const uiStateMock = { sourceMode: false as boolean };
const tiptapMock = {
  editor: null as null | { state: { selection: { empty: boolean } } },
};
const pickerMock = {
  isOpen: false,
  openPicker: vi.fn<(opts?: { filterScope?: string }) => void>(),
  closePicker: vi.fn<() => void>(),
};

vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => uiStateMock },
}));
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: { getState: () => ({ tiptap: tiptapMock }) },
}));
vi.mock("@/stores/geniePickerStore", () => ({
  useGeniePickerStore: { getState: () => pickerMock },
}));

import { detectScope, registerGenieCommands } from "./genieCommands";
import { executeCommand, getCommand, _resetCommandBus } from "./CommandBus";

beforeEach(() => {
  uiStateMock.sourceMode = false;
  tiptapMock.editor = null;
  pickerMock.isOpen = false;
  pickerMock.openPicker.mockReset();
  pickerMock.closePicker.mockReset();
  _resetCommandBus();
});

describe("detectScope", () => {
  it("returns undefined in source mode regardless of selection state", () => {
    uiStateMock.sourceMode = true;
    tiptapMock.editor = { state: { selection: { empty: false } } };
    expect(detectScope()).toBeUndefined();
  });

  it("returns undefined when there is no editor", () => {
    tiptapMock.editor = null;
    expect(detectScope()).toBeUndefined();
  });

  it("returns undefined when the selection is empty", () => {
    tiptapMock.editor = { state: { selection: { empty: true } } };
    expect(detectScope()).toBeUndefined();
  });

  it("returns 'selection' when there is a non-empty selection", () => {
    tiptapMock.editor = { state: { selection: { empty: false } } };
    expect(detectScope()).toBe("selection");
  });
});

describe("registerGenieCommands", () => {
  it("registers genies.togglePicker and genies.openPicker under the ai category", () => {
    registerGenieCommands();
    expect(getCommand("genies.togglePicker")?.category).toBe("ai");
    expect(getCommand("genies.openPicker")?.category).toBe("ai");
  });

  it("is idempotent (second call does not throw)", () => {
    registerGenieCommands();
    expect(() => registerGenieCommands()).not.toThrow();
  });

  it("genies.togglePicker opens the picker when closed, with the detected scope", async () => {
    tiptapMock.editor = { state: { selection: { empty: false } } };
    pickerMock.isOpen = false;
    registerGenieCommands();
    await executeCommand("genies.togglePicker");
    expect(pickerMock.openPicker).toHaveBeenCalledWith({ filterScope: "selection" });
    expect(pickerMock.closePicker).not.toHaveBeenCalled();
  });

  it("genies.togglePicker closes the picker when open", async () => {
    pickerMock.isOpen = true;
    registerGenieCommands();
    await executeCommand("genies.togglePicker");
    expect(pickerMock.closePicker).toHaveBeenCalledTimes(1);
    expect(pickerMock.openPicker).not.toHaveBeenCalled();
  });

  it("genies.openPicker always opens with the detected scope", async () => {
    tiptapMock.editor = { state: { selection: { empty: true } } };
    pickerMock.isOpen = true; // openPicker ignores isOpen — always opens
    registerGenieCommands();
    await executeCommand("genies.openPicker");
    expect(pickerMock.openPicker).toHaveBeenCalledWith({ filterScope: undefined });
    expect(pickerMock.closePicker).not.toHaveBeenCalled();
  });
});
