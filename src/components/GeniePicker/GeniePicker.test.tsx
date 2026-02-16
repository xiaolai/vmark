/**
 * GeniePicker IME Guard Tests
 *
 * Verifies that IME composition events (isComposing, keyCode 229)
 * are blocked from triggering actions in the GeniePicker.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// Mock stores
const mockClosePicker = vi.fn();

let pickerState = {
  isOpen: true,
  filterScope: null as string | null,
  closePicker: mockClosePicker,
};

vi.mock("@/stores/geniePickerStore", () => ({
  useGeniePickerStore: Object.assign(
    (selector: (s: typeof pickerState) => unknown) => selector(pickerState),
    {
      getState: () => pickerState,
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

vi.mock("@/stores/geniesStore", () => ({
  useGeniesStore: Object.assign(
    (selector: (s: { genies: never[]; loading: boolean }) => unknown) =>
      selector({ genies: [], loading: false }),
    {
      getState: () => ({
        genies: [],
        loading: false,
        loadGenies: vi.fn(),
        getRecent: () => [],
      }),
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

const mockInvokeGenie = vi.fn();
const mockInvokeFreeform = vi.fn();

vi.mock("@/hooks/useGenieInvocation", () => ({
  useGenieInvocation: () => ({
    invokeGenie: mockInvokeGenie,
    invokeFreeform: mockInvokeFreeform,
    isRunning: false,
  }),
}));

vi.mock("@/stores/aiProviderStore", () => ({
  useAiProviderStore: Object.assign(
    (selector: (s: { activeProvider: null }) => unknown) =>
      selector({ activeProvider: null }),
    {
      getState: () => ({
        activeProvider: null,
        getActiveProviderName: () => "test",
      }),
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

vi.mock("@/hooks/usePromptHistory", () => ({
  usePromptHistory: () => ({
    displayValue: "",
    ghostText: "",
    handleChange: vi.fn(),
    handleKeyDown: vi.fn(),
    recordAndReset: vi.fn(),
    reset: vi.fn(),
    isDropdownOpen: false,
    dropdownEntries: [],
    dropdownSelectedIndex: 0,
    openDropdown: vi.fn(),
    closeDropdown: vi.fn(),
    selectDropdownEntry: vi.fn(),
  }),
}));

import { GeniePicker } from "./GeniePicker";

describe("GeniePicker — IME composition guard", () => {
  beforeEach(() => {
    pickerState = {
      isOpen: true,
      filterScope: null,
      closePicker: mockClosePicker,
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("Enter with isComposing does not invoke a genie", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Enter", isComposing: true });

    expect(mockInvokeGenie).not.toHaveBeenCalled();
    expect(mockInvokeFreeform).not.toHaveBeenCalled();
  });

  it("Escape with isComposing does not close picker", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Escape", isComposing: true });

    expect(mockClosePicker).not.toHaveBeenCalled();
  });

  it("Enter within grace period after compositionEnd is blocked", () => {
    render(<GeniePicker />);

    const searchInput = document.querySelector(".genie-picker-search") as HTMLElement;
    const container = document.querySelector(".genie-picker") as HTMLElement;

    // Simulate composition then immediate Enter (macOS WebKit pattern)
    fireEvent.compositionStart(searchInput);
    fireEvent.compositionEnd(searchInput);
    fireEvent.keyDown(container, { key: "Enter" });

    expect(mockInvokeGenie).not.toHaveBeenCalled();
    expect(mockClosePicker).not.toHaveBeenCalled();
  });

  it("keyCode 229 (IME marker) is blocked", () => {
    render(<GeniePicker />);

    const container = document.querySelector(".genie-picker") as HTMLElement;
    fireEvent.keyDown(container, { key: "Enter", keyCode: 229 });

    expect(mockInvokeGenie).not.toHaveBeenCalled();
  });
});
