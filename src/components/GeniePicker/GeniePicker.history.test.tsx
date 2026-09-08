/**
 * GeniePicker — the prompt-history dropdown and ghost completion, driven
 * through the REAL `usePromptHistory` hook and the real history store (audit
 * 20260907, #312 round 2). `GeniePicker.test.tsx` and the lifecycle suite mock
 * the hook, so nothing there could see an open dropdown that the combobox
 * still reported collapsed, or a filter that stopped narrowing the rows.
 *
 * Only the invocation hook is mocked (its stream is Tauri-backed). The history
 * store persists through localStorage, which jsdom provides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GenieDefinition } from "@/types/aiGenies";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useGeniesStore, usePromptHistoryStore } from "@/stores/aiStore";

const mockInvokeGenie = vi.fn();
const mockInvokeFreeform = vi.fn();
vi.mock("@/hooks/useGenieInvocation", () => ({
  useGenieInvocation: () => ({ invokeGenie: mockInvokeGenie, invokeFreeform: mockInvokeFreeform }),
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

const input = () => screen.getByRole("combobox") as HTMLTextAreaElement;
const dropdown = () => document.querySelector(".prompt-history-dropdown");
const options = () =>
  [...document.querySelectorAll(".prompt-history-dropdown-item")].map((el) => ({
    text: el.textContent,
    selected: el.getAttribute("aria-selected") === "true",
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mockInvokeFreeform.mockResolvedValue(undefined);
  // Only `polish` matches, so any draft without an "l"/"o"/"p"… run below stays freeform.
  useGeniesStore.setState({ genies: [genie("polish")], loading: false, loadGenies: () => Promise.resolve() } as never);
  usePromptHistoryStore.setState({ entries: [] });
  usePromptHistoryStore.getState().addEntry("translate to german");
  usePromptHistoryStore.getState().addEntry("translate to french"); // MRU: first
  useGeniePickerStore.getState().openPicker();
});

afterEach(() => {
  cleanup();
  useGeniePickerStore.getState().closePicker();
});

describe("GeniePicker — the history dropdown through the real hook (#312)", () => {
  it("Ctrl+R opens the dropdown over the draft's matches, and the combobox reports it expanded", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    await user.type(input(), "translate to");
    // No genie matches, so the combobox is collapsed until history opens.
    expect(input()).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(input(), { key: "r", ctrlKey: true });

    expect(dropdown()).not.toBeNull();
    expect(options().map((o) => o.text)).toEqual(["translate to french", "translate to german"]);
    expect(options()[0].selected).toBe(true);
    expect(input()).toHaveAttribute("aria-expanded", "true");
  });

  it("typing narrows the open dropdown to the rows that contain the draft", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    await user.type(input(), "translate to");
    fireEvent.keyDown(input(), { key: "r", ctrlKey: true });
    expect(options()).toHaveLength(2);

    // `keyboard`, not `type`: `type` clicks the element first, and a mousedown
    // outside the dropdown's list is exactly what closes it.
    await user.keyboard(" g");

    expect(options().map((o) => o.text)).toEqual(["translate to german"]);
    expect(input()).toHaveAttribute("aria-expanded", "true");
  });

  it("ArrowDown/ArrowUp move the highlighted row and Enter puts it in the textarea", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    await user.type(input(), "translate to");
    fireEvent.keyDown(input(), { key: "r", ctrlKey: true });

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options().map((o) => o.selected)).toEqual([false, true]);
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(options().map((o) => o.selected)).toEqual([true, false]);
    fireEvent.keyDown(input(), { key: "ArrowDown" });

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("translate to german");
    expect(dropdown()).toBeNull();
    expect(input()).toHaveAttribute("aria-expanded", "false");
    // Selecting a row is not a submission.
    expect(mockInvokeFreeform).not.toHaveBeenCalled();
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
  });

  it("Escape peels one layer at a time: the dropdown, then the ghost completion, then the picker", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    await user.type(input(), "translate to");
    fireEvent.keyDown(input(), { key: "r", ctrlKey: true });
    expect(dropdown()).not.toBeNull();
    const ghost = () => document.querySelector(".genie-freeform-ghost-text");
    expect(ghost()).toBeNull(); // hidden while the dropdown is up

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(dropdown()).toBeNull();
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
    expect(input().value).toBe("translate to");
    expect(ghost()?.textContent).toBe(" french"); // back once the dropdown is gone

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(ghost()).toBeNull();
    expect(useGeniePickerStore.getState().isOpen).toBe(true);

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  it("a mousedown outside the dropdown (on the textarea) closes it without closing the picker", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    await user.type(input(), "translate to");
    fireEvent.keyDown(input(), { key: "r", ctrlKey: true });
    expect(dropdown()).not.toBeNull();

    fireEvent.mouseDown(input());

    expect(dropdown()).toBeNull();
    expect(useGeniePickerStore.getState().isOpen).toBe(true);
  });

  it("the ghost completion follows the draft and Tab accepts it into the textarea", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    await user.type(input(), "trans");

    const ghost = () => document.querySelector(".genie-freeform-ghost-text")?.textContent ?? null;
    expect(ghost()).toBe("late to french");

    fireEvent.keyDown(input(), { key: "Tab" });

    expect(input().value).toBe("translate to french");
    expect(ghost()).toBeNull();
    // Tab was the completion, not the picker's scope cycle.
    expect(screen.getByText(/scope: all/)).toBeInTheDocument();
  });

  it("the first Enter arms the freeform confirmation, typing disarms it, and the second Enter submits and records the prompt", async () => {
    const user = userEvent.setup();
    render(<GeniePicker />);
    const picker = document.querySelector(".genie-picker") as HTMLElement;
    await user.type(input(), "xyz");
    expect(document.querySelector(".genie-picker-confirm-hint")).toBeNull();

    fireEvent.keyDown(picker, { key: "Enter" });
    expect(document.querySelector(".genie-picker-confirm-hint")).not.toBeNull();

    await user.type(input(), "!");
    expect(document.querySelector(".genie-picker-confirm-hint")).toBeNull();

    fireEvent.keyDown(picker, { key: "Enter" });
    fireEvent.keyDown(picker, { key: "Enter" });

    expect(mockInvokeFreeform).toHaveBeenCalledWith("xyz!", "selection");
    expect(usePromptHistoryStore.getState().entries[0]).toBe("xyz!");
    expect(input().value).toBe("");
  });
});
