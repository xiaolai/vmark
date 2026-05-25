// Phase 7 WI-7.2 — SaveControls tests.
//
// Verifies dirty-state surfacing + Save / Discard wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflowStore";
import { SaveControls } from "../SaveControls";

beforeEach(() => {
  useWorkflowStore.getState().resetEdit();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SaveControls — clean state", () => {
  it("renders disabled buttons when there are no pending patches", () => {
    render(<SaveControls onSave={async () => {}} onDiscard={() => {}} />);
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    const discard = screen.getByRole("button", { name: /discard/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);
  });

  it("shows the clean-state hint", () => {
    render(<SaveControls onSave={async () => {}} onDiscard={() => {}} />);
    expect(screen.getByText(/no pending edits/i)).toBeDefined();
  });
});

describe("SaveControls — dirty state", () => {
  it("enables both buttons and shows count when patches exist", () => {
    useWorkflowStore.getState().queuePatch({
      kind: "workflow.set",
      path: "name",
      value: "x",
    });
    // Distinct target so dedup doesn't collapse them.
    useWorkflowStore.getState().queuePatch({
      kind: "workflow.set",
      path: "run-name",
      value: "y",
    });
    render(<SaveControls onSave={async () => {}} onDiscard={() => {}} />);
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    const discard = screen.getByRole("button", { name: /discard/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(discard.disabled).toBe(false);
    expect(screen.getByText(/2 unsaved/i)).toBeDefined();
  });

  it("calls onSave when Save is clicked", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    useWorkflowStore.getState().queuePatch({
      kind: "workflow.set",
      path: "name",
      value: "x",
    });
    render(<SaveControls onSave={onSave} onDiscard={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });
    expect(onSave).toHaveBeenCalled();
  });

  it("calls onDiscard and clearPatches when Discard is clicked", () => {
    const onDiscard = vi.fn();
    useWorkflowStore.getState().queuePatch({
      kind: "workflow.set",
      path: "name",
      value: "x",
    });
    render(<SaveControls onSave={async () => {}} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalled();
    expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([]);
  });
});
