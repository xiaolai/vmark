// TriggerForm tests — read for non-editable shapes, edit for mapping shapes.
//
// "Editable" means at least one filter is populated (branches, paths,
// types, etc.). That's the same condition the trigger.setFilters mutator
// can safely act on; for scalar/array `on:` forms we render a
// read-only hint instead.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { TriggerIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { TriggerForm } from "../TriggerForm";

beforeEach(() => {
  useWorkflowEditStore.setState({
    pendingPatches: [],
    preserveYamlFormatting: true,
  });
});

afterEach(() => {
  cleanup();
});

function makeTrigger(overrides: Partial<TriggerIR> = {}): TriggerIR {
  return {
    event: "push",
    position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    ...overrides,
  };
}

describe("TriggerForm — display", () => {
  it("renders nothing-found state when triggers is empty", () => {
    render(<TriggerForm triggers={[]} />);
    expect(screen.getByText(/no triggers/i)).toBeDefined();
  });

  it("renders an event name as monospace text", () => {
    render(<TriggerForm triggers={[makeTrigger({ event: "push" })]} />);
    expect(screen.getByText("push")).toBeDefined();
  });

  it("renders read-only hint when trigger has no filters and no cron", () => {
    render(<TriggerForm triggers={[makeTrigger({ event: "push" })]} />);
    expect(screen.getByText(/edit in source/i)).toBeDefined();
  });

  it("renders cron schedules in the metadata row", () => {
    render(
      <TriggerForm
        triggers={[makeTrigger({ event: "schedule", cron: "0 0 * * *" })]}
      />,
    );
    expect(screen.getByText(/0 0 \* \* \*/)).toBeDefined();
  });

  it("renders multiple triggers as a list", () => {
    render(
      <TriggerForm
        triggers={[
          makeTrigger({ event: "push", branches: ["main"] }),
          makeTrigger({
            event: "pull_request",
            branches: ["main"],
            types: ["opened", "synchronize"],
          }),
        ]}
      />,
    );
    expect(screen.getByText("push")).toBeDefined();
    expect(screen.getByText("pull_request")).toBeDefined();
  });
});

describe("TriggerForm — editing", () => {
  it("shows editable inputs when a trigger has filters populated", () => {
    render(
      <TriggerForm
        triggers={[makeTrigger({ branches: ["main", "develop"] })]}
      />,
    );
    const input = screen.getByDisplayValue("main, develop") as HTMLInputElement;
    expect(input).toBeDefined();
  });

  it("queues a trigger.setFilters patch when branches input changes", () => {
    render(
      <TriggerForm triggers={[makeTrigger({ branches: ["main"] })]} />,
    );
    const input = screen.getByDisplayValue("main") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "main, develop, release/*" } });
    fireEvent.blur(input);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      {
        kind: "trigger.setFilters",
        event: "push",
        filter: "branches",
        value: ["main", "develop", "release/*"],
      },
    ]);
  });

  it("emits an empty array when the input is cleared", () => {
    render(
      <TriggerForm triggers={[makeTrigger({ paths: ["src/**"] })]} />,
    );
    const input = screen.getByDisplayValue("src/**") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      {
        kind: "trigger.setFilters",
        event: "push",
        filter: "paths",
        value: [],
      },
    ]);
  });

  it("does not queue a patch when the value is unchanged", () => {
    render(
      <TriggerForm
        triggers={[makeTrigger({ branches: ["main", "develop"] })]}
      />,
    );
    const input = screen.getByDisplayValue("main, develop") as HTMLInputElement;
    fireEvent.blur(input); // No change before blur.
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([]);
  });

  it("emits patches for each filter family independently", () => {
    render(
      <TriggerForm
        triggers={[
          makeTrigger({
            event: "pull_request",
            branches: ["main"],
            types: ["opened"],
          }),
        ]}
      />,
    );
    const branches = screen.getByDisplayValue("main") as HTMLInputElement;
    const types = screen.getByDisplayValue("opened") as HTMLInputElement;
    fireEvent.change(branches, { target: { value: "main, develop" } });
    fireEvent.blur(branches);
    fireEvent.change(types, { target: { value: "opened, synchronize" } });
    fireEvent.blur(types);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      {
        kind: "trigger.setFilters",
        event: "pull_request",
        filter: "branches",
        value: ["main", "develop"],
      },
      {
        kind: "trigger.setFilters",
        event: "pull_request",
        filter: "types",
        value: ["opened", "synchronize"],
      },
    ]);
  });
});
