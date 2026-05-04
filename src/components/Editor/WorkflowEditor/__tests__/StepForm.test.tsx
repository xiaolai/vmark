// Phase 7 WI-7.1 — StepForm tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { StepIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { StepForm } from "../StepForm";

function makeStep(overrides: Partial<StepIR> = {}): StepIR {
  return {
    id: "checkout",
    idSynthesized: false,
    name: "Checkout",
    uses: "actions/checkout@v4",
    position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  useWorkflowEditStore.setState({
    pendingPatches: [],
    preserveYamlFormatting: true,
  });
});

afterEach(() => {
  cleanup();
});

describe("StepForm — display", () => {
  it("shows the step's name", () => {
    render(
      <StepForm jobId="build" stepIndex={0} step={makeStep({ name: "Hi" })} />,
    );
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(input.value).toBe("Hi");
  });

  it("shows uses for a uses-step (read-only display)", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({ uses: "actions/setup-node@v4" })}
      />,
    );
    expect(screen.getByText(/actions\/setup-node@v4/)).toBeDefined();
  });

  it("shows run for a run-step (editable)", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={1}
        step={makeStep({
          id: "run-step",
          uses: undefined,
          run: "echo hello",
          name: "Hello",
        })}
      />,
    );
    const input = screen.getByLabelText(/^run/i) as HTMLTextAreaElement;
    expect(input.value).toBe("echo hello");
  });

  it("shows existing with: keys as key/value rows", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({
          with: { "node-version": "20", cache: "pnpm" },
        })}
      />,
    );
    expect(screen.getByDisplayValue("node-version")).toBeDefined();
    expect(screen.getByDisplayValue("20")).toBeDefined();
    expect(screen.getByDisplayValue("cache")).toBeDefined();
    expect(screen.getByDisplayValue("pnpm")).toBeDefined();
  });
});

describe("StepForm — emits patches", () => {
  it("queues step.set on name change", () => {
    render(<StepForm jobId="build" stepIndex={0} step={makeStep()} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      { kind: "step.set", jobId: "build", stepIndex: 0, path: "name", value: "Renamed" },
    ]);
  });

  it("queues step.set on run change", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={2}
        step={makeStep({
          id: "r",
          uses: undefined,
          run: "echo a",
          name: "R",
        })}
      />,
    );
    const input = screen.getByLabelText(/^run/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "echo b" } });
    fireEvent.blur(input);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      { kind: "step.set", jobId: "build", stepIndex: 2, path: "run", value: "echo b" },
    ]);
  });

  it("queues with.set when an existing with key value changes", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({ with: { "node-version": "20" } })}
      />,
    );
    const valueInput = screen.getByDisplayValue("20") as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "22" } });
    fireEvent.blur(valueInput);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      {
        kind: "with.set",
        jobId: "build",
        stepIndex: 0,
        key: "node-version",
        value: "22",
      },
    ]);
  });

  it("queues with.remove when the X button is pressed on a row", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({ with: { cache: "pnpm" } })}
      />,
    );
    const removeBtn = screen.getByRole("button", { name: /remove/i });
    fireEvent.click(removeBtn);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      { kind: "with.remove", jobId: "build", stepIndex: 0, key: "cache" },
    ]);
  });

  it("queues step.set on working-directory change", () => {
    render(<StepForm jobId="build" stepIndex={0} step={makeStep()} />);
    const input = screen.getByLabelText(/working directory/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "./apps/web" } });
    fireEvent.blur(input);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      {
        kind: "step.set",
        jobId: "build",
        stepIndex: 0,
        path: "working-directory",
        value: "./apps/web",
      },
    ]);
  });

  it("queues step.set on if change", () => {
    render(<StepForm jobId="build" stepIndex={0} step={makeStep()} />);
    const input = screen.getByLabelText(/condition|^if/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "always()" } });
    fireEvent.blur(input);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      { kind: "step.set", jobId: "build", stepIndex: 0, path: "if", value: "always()" },
    ]);
  });

  it("renames an existing with: key — emits remove + set", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({ with: { "node-version": "20" } })}
      />,
    );
    const keyInput = screen.getByDisplayValue("node-version") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "node-version-renamed" } });
    fireEvent.blur(keyInput);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      { kind: "with.remove", jobId: "build", stepIndex: 0, key: "node-version" },
      {
        kind: "with.set",
        jobId: "build",
        stepIndex: 0,
        key: "node-version-renamed",
        value: "20",
      },
    ]);
  });

  it("removing a newly-added (un-saved) with-row does NOT emit a remove patch", () => {
    render(<StepForm jobId="build" stepIndex={0} step={makeStep()} />);
    fireEvent.click(screen.getByRole("button", { name: /add input/i }));
    const removeBtns = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeBtns[removeBtns.length - 1]);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([]);
  });

  it("adds a new with-row + queues with.set when the user fills it in", () => {
    render(<StepForm jobId="build" stepIndex={0} step={makeStep()} />);
    const addBtn = screen.getByRole("button", { name: /add input/i });
    fireEvent.click(addBtn);
    // After clicking add, a new pair of inputs appears.
    const keyInputs = screen.getAllByPlaceholderText("key");
    const valueInputs = screen.getAllByPlaceholderText("value");
    fireEvent.change(keyInputs[keyInputs.length - 1], {
      target: { value: "registry-url" },
    });
    fireEvent.change(valueInputs[valueInputs.length - 1], {
      target: { value: "https://npm.example.com" },
    });
    fireEvent.blur(valueInputs[valueInputs.length - 1]);
    expect(useWorkflowEditStore.getState().pendingPatches).toEqual([
      {
        kind: "with.set",
        jobId: "build",
        stepIndex: 0,
        key: "registry-url",
        value: "https://npm.example.com",
      },
    ]);
  });
});
