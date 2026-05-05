// WI-C.3 — ConcurrencyForm tests.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { ConcurrencyForm } from "../ConcurrencyForm";

beforeEach(() => {
  useWorkflowEditStore.setState({
    pendingPatches: [],
    preserveYamlFormatting: true,
  });
});

describe("ConcurrencyForm", () => {
  it("seeds inputs from existing concurrency IR", () => {
    render(
      <ConcurrencyForm
        concurrency={{ group: "ci", cancelInProgress: true }}
      />,
    );
    const groupInput = screen.getByPlaceholderText(
      /github\.ref/,
    ) as HTMLInputElement;
    expect(groupInput.value).toBe("ci");
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("emits null patch when group becomes empty (clears the field)", () => {
    render(<ConcurrencyForm concurrency={{ group: "ci" }} />);
    const groupInput = screen.getByPlaceholderText(/github\.ref/);
    fireEvent.change(groupInput, { target: { value: "" } });
    fireEvent.blur(groupInput);
    const patches = useWorkflowEditStore.getState().pendingPatches;
    expect(patches).toContainEqual({
      kind: "workflow.concurrency.set",
      value: null,
    });
  });

  it("emits string patch when only group is set (no cancel-in-progress)", () => {
    render(<ConcurrencyForm concurrency={undefined} />);
    const groupInput = screen.getByPlaceholderText(/github\.ref/);
    fireEvent.change(groupInput, { target: { value: "deploy" } });
    fireEvent.blur(groupInput);
    const patches = useWorkflowEditStore.getState().pendingPatches;
    expect(patches).toContainEqual({
      kind: "workflow.concurrency.set",
      value: "deploy",
    });
  });

  it("emits mapping patch when group + cancel-in-progress are set", () => {
    render(
      <ConcurrencyForm
        concurrency={{ group: "deploy", cancelInProgress: false }}
      />,
    );
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    const patches = useWorkflowEditStore.getState().pendingPatches;
    const last = patches[patches.length - 1];
    expect(last).toEqual({
      kind: "workflow.concurrency.set",
      value: { group: "deploy", cancelInProgress: true },
    });
  });

  it("checkbox is disabled when group is empty", () => {
    render(<ConcurrencyForm concurrency={undefined} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });
});
