/**
 * GeniePicker — the freeform prompt's preconditions (audit R3 #616 / #621).
 *
 * A separate file rather than more of `GeniePicker.test.tsx`, which is at its
 * frozen test-file size — and one built on the REAL stores, seeded with
 * `setState`, as `lint:mock-boundaries` requires. Only genuine boundaries are
 * mocked: the invocation hook and the Tauri IPC the catalogue is read over.
 *
 * @coordinates-with ./GeniePicker.tsx — the component under test
 * @module components/GeniePicker/GeniePicker.freeform.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GenieDefinition } from "@/types/aiGenies";

const mockInvokeGenie = vi.fn();
const mockInvokeFreeform = vi.fn();
const mockCancel = vi.fn();

// The genie catalogue is read over IPC. A request that never settles leaves the
// real `loadGenies` parked with `loading: true`, so the seeding below is the
// last word on the store rather than racing a rejection handler.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => new Promise(() => {}),
}));

vi.mock("@/hooks/useGenieInvocation", () => ({
  useGenieInvocation: () => ({
    invokeGenie: mockInvokeGenie,
    invokeFreeform: mockInvokeFreeform,
    cancel: mockCancel,
  }),
}));

import { GeniePicker } from "./GeniePicker";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useGeniesStore } from "@/stores/aiStore";

function makeGenie(name: string): GenieDefinition {
  return {
    metadata: {
      name,
      description: `${name} description`,
      scope: "selection",
      category: "Writing",
    },
    template: "{{content}}",
    filePath: `/genies/${name}.md`,
    source: "global",
  } as GenieDefinition;
}

const SAMPLE = [makeGenie("polish"), makeGenie("condense")];

function getInput(): HTMLTextAreaElement {
  return document.querySelector(".genie-picker-search") as HTMLTextAreaElement;
}

function panel(): HTMLElement {
  return document.querySelector(".genie-picker") as HTMLElement;
}

/**
 * Open the picker and seed the real genies store for one case.
 *
 * Seeded AFTER the render: mounting runs the picker's own `loadGenies`, which
 * sets `loading: true` before anything this test says.
 */
function open({ genies, loading }: { genies: GenieDefinition[]; loading: boolean }) {
  useGeniePickerStore.getState().openPicker();
  const view = render(<GeniePicker />);
  act(() => {
    useGeniesStore.setState({ genies, loading, recentGenieNames: [] });
  });
  return view;
}

beforeEach(() => {
  mockInvokeGenie.mockReset();
  mockInvokeFreeform.mockReset();
  mockCancel.mockReset();
  useGeniePickerStore.getState().closePicker();
  useGeniesStore.setState({ genies: [], loading: false, recentGenieNames: [] });
});

afterEach(() => {
  cleanup();
  useGeniePickerStore.getState().closePicker();
});

describe("GeniePicker — the freeform prompt's preconditions", () => {
  it("does not offer a freeform prompt while the genies are still LOADING (#616)", async () => {
    // An empty list during a load is not "no genie matches" — it is "we do not
    // know yet". Enter used to accept the text as a freeform prompt even when
    // the list about to arrive held a genie for exactly that query.
    open({ genies: [], loading: true });
    await userEvent.setup().type(getInput(), "translate this");

    fireEvent.keyDown(panel(), { key: "Enter" });
    fireEvent.keyDown(panel(), { key: "Enter" });
    expect(mockInvokeFreeform).not.toHaveBeenCalled();
  });

  it("submits a freeform prompt on the SECOND Enter once loading has finished", async () => {
    open({ genies: [], loading: false });
    await userEvent.setup().type(getInput(), "translate this");

    fireEvent.keyDown(panel(), { key: "Enter" });
    expect(mockInvokeFreeform).not.toHaveBeenCalled();
    fireEvent.keyDown(panel(), { key: "Enter" });
    expect(mockInvokeFreeform).toHaveBeenCalledTimes(1);
  });

  it("treats a whitespace-only prompt as no prompt at all (#621)", async () => {
    // The hint was rendered on the RAW value while submission trimmed it, so
    // spaces produced an actionable hint whose Enter did nothing.
    open({ genies: SAMPLE, loading: false });
    await userEvent.setup().type(getInput(), "   ");

    expect(document.querySelector(".genie-picker-no-match")).toBeNull();
    fireEvent.keyDown(panel(), { key: "Enter" });
    fireEvent.keyDown(panel(), { key: "Enter" });
    expect(mockInvokeFreeform).not.toHaveBeenCalled();
  });

  it("still finds genies after leading and trailing spaces are typed", async () => {
    open({ genies: SAMPLE, loading: false });
    await userEvent.setup().type(getInput(), "  polish  ");
    expect(screen.getByText("polish")).toBeInTheDocument();
    expect(screen.queryByText("condense")).not.toBeInTheDocument();
  });
});
