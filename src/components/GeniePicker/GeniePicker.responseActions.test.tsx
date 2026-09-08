/**
 * GeniePicker — what ends a response mode, and whose keys the dialog owns
 * (audit R2, #611/#612/#613/#615/#618/#622).
 *
 * Against the REAL picker and suggestion stores: the defects here are about
 * WHICH suggestion the picker acts on, and a mocked suggestion store cannot
 * express the rule that produced them — `addSuggestion` focuses a new
 * suggestion only when nothing is focused already, so `focusedSuggestionId`
 * keeps naming an older one and Accept applied an edit the user never
 * previewed. Only the two boundary hooks are mocked: the invocation (its
 * stream is Tauri-backed) and prompt history (persisted).
 *
 * @coordinates-with src/components/GeniePicker/GeniePicker.tsx — the subject
 * @coordinates-with src/components/GeniePicker/useInvocationSession.ts — the session + actions
 * @module components/GeniePicker/GeniePicker.responseActions.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useAiProviderStore, useAiSuggestionStore } from "@/stores/aiStore";

const mockInvokeGenie = vi.fn();
const mockInvokeFreeform = vi.fn();
/** The hook's FULL cancel: unlistens AND asks Rust to stop the provider (#613). */
const mockCancel = vi.fn();
vi.mock("@/hooks/useGenieInvocation", () => ({
  useGenieInvocation: () => ({
    invokeGenie: mockInvokeGenie,
    invokeFreeform: mockInvokeFreeform,
    cancel: mockCancel,
  }),
}));

vi.mock("@/hooks/usePromptHistory", () => ({
  usePromptHistory: () => ({
    displayValue: "",
    ghostText: "",
    isDropdownOpen: false,
    dropdownEntries: [] as string[],
    dropdownSelectedIndex: 0,
    handleChange: vi.fn(),
    handleKeyDown: vi.fn(),
    openDropdown: vi.fn(),
    recordAndReset: vi.fn(),
    reset: vi.fn(),
    clearHistory: vi.fn(),
    closeDropdown: vi.fn(),
    selectDropdownEntry: vi.fn(),
  }),
}));

import { GeniePicker } from "./GeniePicker";

/** Add a real suggestion, which is what announces itself to the picker. */
function addSuggestion(newContent: string): string {
  let id = "";
  act(() => {
    id = useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "replace",
      from: 0,
      to: 1,
      newContent,
      originalContent: "x",
    });
  });
  return id;
}

function panel(): HTMLElement {
  return document.querySelector(".genie-picker") as HTMLElement;
}

beforeEach(() => {
  mockCancel.mockReset();
  mockInvokeGenie.mockReset();
  useAiSuggestionStore.setState({ suggestions: new Map(), focusedSuggestionId: null });
  useAiProviderStore.setState({ activeProvider: null });
  act(() => {
    useGeniePickerStore.getState().openPicker();
  });
});

afterEach(() => {
  cleanup();
  act(() => {
    useGeniePickerStore.getState().closePicker();
  });
});

describe("the picker acts on the suggestion ITS session created", () => {
  it("accepts its own suggestion, not the older focused one", async () => {
    const user = userEvent.setup();
    const older = addSuggestion("older edit");
    render(<GeniePicker />);
    const mine = addSuggestion("this session's edit");
    // The store keeps the FIRST focus; that is the whole defect (#611).
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(older);
    act(() => {
      useGeniePickerStore.getState().setPreview("this session's edit");
    });

    await user.click(screen.getByRole("button", { name: /accept/i }));

    const left = useAiSuggestionStore.getState().suggestions;
    expect(left.has(mine)).toBe(false);
    expect(left.has(older)).toBe(true);
  });

  it("rejects its own suggestion instead of leaving it live", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    const mine = addSuggestion("edit");
    act(() => {
      useGeniePickerStore.getState().setPreview("edit");
    });

    await user.click(screen.getByRole("button", { name: /^reject/i }));

    // Wired straight to `handleClose` before, so a "rejected" edit stayed in
    // the editor where it could still be accepted later (#622).
    expect(useAiSuggestionStore.getState().suggestions.has(mine)).toBe(false);
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("drops its suggestion on Retry rather than stranding it (#612)", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    const mine = addSuggestion("edit");
    act(() => {
      useGeniePickerStore.getState().setPreview("edit");
    });

    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(useAiSuggestionStore.getState().suggestions.has(mine)).toBe(false);
    expect(useGeniePickerStore.getState().mode).toBe("search");
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
  });

  it("acts on a suggestion ONCE — Escape after Retry drops nothing more", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    // Added FIRST, so the session's own suggestion is the later `mine`.
    const other = addSuggestion("unrelated");
    const mine = addSuggestion("edit");
    act(() => {
      useGeniePickerStore.getState().setPreview("edit");
    });

    await user.click(screen.getByRole("button", { name: /retry/i }));
    fireEvent.keyDown(panel(), { key: "Escape" });

    expect(useAiSuggestionStore.getState().suggestions.has(other)).toBe(true);
    expect(useAiSuggestionStore.getState().suggestions.has(mine)).toBe(false);
  });

  it("leaves every suggestion alone when it created none", async () => {
    const user = userEvent.setup();
    const older = addSuggestion("older edit");
    render(<GeniePicker />);
    act(() => {
      useGeniePickerStore.getState().setPreview("nothing of mine");
    });

    await user.click(screen.getByRole("button", { name: /accept/i }));

    expect(useAiSuggestionStore.getState().suggestions.has(older)).toBe(true);
  });
});

describe("leaving a response mode ends the invocation behind it", () => {
  it("Cancel calls the hook's cancel, not the store's state reset (#613)", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    act(() => {
      useGeniePickerStore.getState().startProcessing("Polish");
    });

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(useGeniePickerStore.getState().mode).toBe("search");
  });

  it("Escape in processing mode cancels the same way", () => {
    render(<GeniePicker />);
    act(() => {
      useGeniePickerStore.getState().startProcessing("Polish");
    });

    fireEvent.keyDown(panel(), { key: "Escape" });

    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  // Audit R2 #618 — an outside click used to close and nothing else, so the
  // invocation kept streaming and produced a suggestion after the dismissal.
  it("an outside click during processing cancels before closing", () => {
    vi.useFakeTimers();
    try {
      render(<GeniePicker />);
      act(() => {
        useGeniePickerStore.getState().startProcessing("Polish");
      });
      act(() => {
        vi.runAllTimers();
      });

      fireEvent.mouseDown(document.body);

      expect(mockCancel).toHaveBeenCalledTimes(1);
      expect(useGeniePickerStore.getState().isOpen).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an outside click during a preview drops that preview's suggestion", () => {
    vi.useFakeTimers();
    try {
      render(<GeniePicker />);
      const mine = addSuggestion("edit");
      act(() => {
        useGeniePickerStore.getState().setPreview("edit");
      });
      act(() => {
        vi.runAllTimers();
      });

      fireEvent.mouseDown(document.body);

      expect(useAiSuggestionStore.getState().suggestions.has(mine)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an outside click from the input surface cancels nothing", () => {
    vi.useFakeTimers();
    try {
      render(<GeniePicker />);
      act(() => {
        vi.runAllTimers();
      });

      fireEvent.mouseDown(document.body);

      expect(mockCancel).not.toHaveBeenCalled();
      expect(useGeniePickerStore.getState().isOpen).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Audit R2 #615 — the handler sits on the whole dialog. `preventDefault` on
// keydown cancels a button's CLICK, so Enter and Space aimed at the provider
// and response buttons did nothing at all, Tab cycled the scope instead of
// moving focus, and Cmd+C over the response text was swallowed.
describe("keys that belong to a control inside the dialog", () => {
  it("does not swallow Enter aimed at the provider button", () => {
    useAiProviderStore.setState({ activeProvider: "claude" });
    render(<GeniePicker />);

    const trigger = document.querySelector(".provider-switcher-trigger") as HTMLElement;
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    trigger.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(mockInvokeGenie).not.toHaveBeenCalled();
  });

  it("does not cycle the scope on Tab aimed at the provider button", () => {
    useAiProviderStore.setState({ activeProvider: "claude" });
    render(<GeniePicker />);
    const before = document.querySelector(".genie-picker-scope")?.textContent;

    fireEvent.keyDown(document.querySelector(".provider-switcher-trigger") as HTMLElement, {
      key: "Tab",
    });

    expect(document.querySelector(".genie-picker-scope")?.textContent).toBe(before);
  });

  it("still lets Escape through from a control", () => {
    useAiProviderStore.setState({ activeProvider: "claude" });
    render(<GeniePicker />);

    fireEvent.keyDown(document.querySelector(".provider-switcher-trigger") as HTMLElement, {
      key: "Escape",
    });

    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("does not swallow Space on a response button in preview mode", () => {
    render(<GeniePicker />);
    act(() => {
      useGeniePickerStore.getState().setPreview("AI result");
    });

    const accept = screen.getByRole("button", { name: /accept/i });
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    accept.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("does not swallow a modified key over the response text", () => {
    render(<GeniePicker />);
    act(() => {
      useGeniePickerStore.getState().setPreview("AI result");
    });

    const event = new KeyboardEvent("keydown", {
      key: "c",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    panel().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("still blocks an unmodified key typed into the picker while processing", () => {
    render(<GeniePicker />);
    act(() => {
      useGeniePickerStore.getState().startProcessing("Polish");
    });

    const event = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    panel().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

// Audit R2 (#620): the textarea kept `role="combobox"` in response mode, where
// `#genie-picker-list` is not rendered — so `aria-controls` named an absent
// element and `aria-activedescendant` an absent option.
describe("the input is a combobox only while the list exists (#620)", () => {
  it("drops the listbox semantics in preview mode", () => {
    render(<GeniePicker />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();

    act(() => {
      useGeniePickerStore.getState().setPreview("an answer");
    });

    expect(screen.queryByRole("combobox")).toBeNull();
    const field = document.querySelector(".genie-picker-search") as HTMLTextAreaElement;
    expect(field).not.toBeNull();
    expect(field.getAttribute("aria-controls")).toBeNull();
    expect(field.getAttribute("aria-activedescendant")).toBeNull();
    expect(document.getElementById("genie-picker-list")).toBeNull();
  });
});
