/**
 * GeniePicker — invocation lifecycle and prompt-history integration
 * (audit 20260907, #309/#310/#312), against the REAL picker and genie stores.
 *
 * handleClose() used to run BEFORE invokeGenie/invokeFreeform, so `isOpen` was
 * false by the time the stream runner called startProcessing/setPreview/
 * setPickerError — the documented inline processing/preview/error UI
 * (website/guide/ai-genies.md, "Processing Feedback") was unreachable. The
 * picker now stays open through the invocation and closes itself only when the
 * invocation settles WITHOUT having entered a response mode (a workflow genie,
 * a provider or scope refusal, the lock busy) — those have nothing to show.
 *
 * Only the two hooks at the boundary are mocked: the invocation (its stream is
 * Tauri-backed) and prompt history (persisted). Everything the assertions read
 * is the store the rest of the app reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GenieDefinition } from "@/types/aiGenies";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useGeniesStore } from "@/stores/aiStore";

const mockInvokeGenie = vi.fn();
const mockInvokeFreeform = vi.fn();
vi.mock("@/hooks/useGenieInvocation", () => ({
  useGenieInvocation: () => ({ invokeGenie: mockInvokeGenie, invokeFreeform: mockInvokeFreeform }),
}));

const history = {
  displayValue: "",
  ghostText: "",
  isDropdownOpen: false,
  dropdownEntries: [] as string[],
  reset: vi.fn(),
  clearHistory: vi.fn(),
  closeDropdown: vi.fn(),
  selectDropdownEntry: vi.fn(),
  recordAndReset: vi.fn(),
};
vi.mock("@/hooks/usePromptHistory", () => ({
  usePromptHistory: () => ({
    get displayValue() {
      return history.displayValue;
    },
    get ghostText() {
      return history.ghostText;
    },
    get isDropdownOpen() {
      return history.isDropdownOpen;
    },
    get dropdownEntries() {
      return history.dropdownEntries;
    },
    dropdownSelectedIndex: 0,
    handleChange: (value: string) => {
      history.displayValue = value;
    },
    handleKeyDown: vi.fn(),
    openDropdown: vi.fn(),
    recordAndReset: history.recordAndReset,
    reset: history.reset,
    clearHistory: history.clearHistory,
    closeDropdown: history.closeDropdown,
    selectDropdownEntry: history.selectDropdownEntry,
  }),
}));

import { GeniePicker } from "./GeniePicker";

Element.prototype.scrollIntoView = vi.fn();

const genie = (name: string): GenieDefinition =>
  ({
    kind: "prompt",
    template: "Do {{content}}",
    metadata: { name, description: "", scope: "selection", category: "Writing" },
    filePath: `/genies/${name}.md`,
    source: "global",
  }) as unknown as GenieDefinition;

const picker = () => document.querySelector(".genie-picker") as HTMLElement;
const input = () => document.querySelector(".genie-picker-search") as HTMLTextAreaElement;
const flushInvocation = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  history.displayValue = "";
  history.ghostText = "";
  history.isDropdownOpen = false;
  history.dropdownEntries = [];
  // The picker loads genies on open through Tauri; hand it a fixed list instead.
  useGeniesStore.setState({ genies: [genie("polish")], loading: false, loadGenies: () => Promise.resolve() } as never);
  useGeniePickerStore.getState().openPicker();
});

afterEach(cleanup);

describe("GeniePicker — the picker stays open for the invocation (#309/#310)", () => {
  it("a prompt genie that enters processing keeps the picker open and shows the processing view", async () => {
    mockInvokeGenie.mockImplementation(() => {
      useGeniePickerStore.getState().startProcessing("Polish");
      return Promise.resolve();
    });
    render(<GeniePicker />);
    fireEvent.keyDown(picker(), { key: "Enter" });
    await flushInvocation();

    expect(mockInvokeGenie).toHaveBeenCalledTimes(1);
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
    expect(useGeniePickerStore.getState().mode).toBe("processing");
    expect(document.querySelector(".genie-picker")).not.toBeNull();
    // The input surface was reset so the response view starts clean.
    expect(input().value).toBe("");
    expect(history.reset).toHaveBeenCalled();
  });

  it("an invocation that never enters a response mode (a workflow genie) closes the picker when it settles", async () => {
    mockInvokeGenie.mockResolvedValue(undefined);
    render(<GeniePicker />);
    fireEvent.keyDown(picker(), { key: "Enter" });
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
    await flushInvocation();

    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("a rejected invocation closes the picker without throwing", async () => {
    mockInvokeGenie.mockRejectedValue(new Error("boom"));
    render(<GeniePicker />);
    fireEvent.keyDown(picker(), { key: "Enter" });
    await flushInvocation();
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("a freeform prompt that enters processing keeps the picker open", async () => {
    const user = userEvent.setup();
    mockInvokeFreeform.mockImplementation(() => {
      useGeniePickerStore.getState().startProcessing("free");
      return Promise.resolve();
    });
    render(<GeniePicker />);
    await user.type(input(), "xyznonexistent");
    fireEvent.keyDown(picker(), { key: "Enter" }); // confirm
    fireEvent.keyDown(picker(), { key: "Enter" }); // submit
    await flushInvocation();

    expect(mockInvokeFreeform).toHaveBeenCalledWith("xyznonexistent", expect.any(String));
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
    expect(useGeniePickerStore.getState().mode).toBe("processing");
  });

  it("a freeform prompt refused before its stream closes the picker", async () => {
    const user = userEvent.setup();
    mockInvokeFreeform.mockResolvedValue(undefined);
    render(<GeniePicker />);
    await user.type(input(), "xyznonexistent");
    fireEvent.keyDown(picker(), { key: "Enter" });
    fireEvent.keyDown(picker(), { key: "Enter" });
    await flushInvocation();
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("an explicit Escape still closes the picker outright", () => {
    render(<GeniePicker />);
    fireEvent.keyDown(picker(), { key: "Escape" });
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });
});

describe("GeniePicker — prompt history dropdown and ghost completion (#312)", () => {
  it("renders the history dropdown with its entries and wires select and clear", async () => {
    const user = userEvent.setup();
    history.isDropdownOpen = true;
    history.dropdownEntries = ["translate to french", "summarize"];
    render(<GeniePicker />);

    expect(screen.getByText("translate to french")).toBeInTheDocument();
    await user.click(screen.getByText("summarize"));
    expect(history.selectDropdownEntry).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole("button", { name: /clear history/i }));
    expect(history.clearHistory).toHaveBeenCalledTimes(1);
  });

  it("renders no dropdown while history is closed", () => {
    history.dropdownEntries = ["translate to french"];
    render(<GeniePicker />);
    expect(screen.queryByText("translate to french")).not.toBeInTheDocument();
  });

  it("renders the ghost completion behind the typed prefix, hidden from assistive tech", async () => {
    const user = userEvent.setup();
    history.ghostText = " to french";
    render(<GeniePicker />);
    await user.type(input(), "translate");

    const ghost = document.querySelector(".genie-freeform-ghost") as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.querySelector(".genie-freeform-ghost-spacer")?.textContent).toBe("translate");
    expect(ghost.querySelector(".genie-freeform-ghost-text")?.textContent).toBe(" to french");
  });

  it("renders no ghost when history offers no completion", () => {
    render(<GeniePicker />);
    expect(document.querySelector(".genie-freeform-ghost")).toBeNull();
  });
});
