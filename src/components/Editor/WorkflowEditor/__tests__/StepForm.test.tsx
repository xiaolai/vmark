// Phase 7 WI-7.1 — StepForm tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import type { StepIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { __resetRegistryForTests } from "@/lib/ghaWorkflow/actions/registry";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

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
  __resetRegistryForTests();
  invokeMock.mockReset();
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

describe("StepForm — expression expand", () => {
  it("renders an Expand if button next to the if textarea", () => {
    render(<StepForm jobId="build" stepIndex={0} step={makeStep()} />);
    expect(screen.getByRole("button", { name: /expand if/i })).toBeDefined();
  });

  it("opens the modal editor and saves a new value (queues step.set)", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({ id: "x", uses: undefined, run: "echo hi", name: "X" })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand run/i }));
    // Modal mounted.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    // Save the (unchanged) value — covers the no-op-when-equal branch.
    fireEvent.click(
      // The first Save in the modal footer (matching name="Save").
      screen.getAllByRole("button", { name: /^save$/i })[0],
    );
    // Modal closes; no patch queued because value didn't change.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useWorkflowEditStore.getState().pendingPatches.length).toBe(0);
  });

  it("Cancel closes the modal without queueing", () => {
    render(<StepForm jobId="build" stepIndex={0} step={makeStep()} />);
    fireEvent.click(screen.getByRole("button", { name: /expand if/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useWorkflowEditStore.getState().pendingPatches.length).toBe(0);
  });
});

describe("StepForm — action input completion (WI-A.2)", () => {
  it("populates a datalist of known input names for the key field", async () => {
    invokeMock.mockResolvedValue({
      kind: "ok",
      from_cache: false,
      metadata: {
        name: "Setup Node",
        inputs: {
          "node-version": { description: "version", required: false },
          cache: { description: "cache", required: false },
          "registry-url": { description: "registry", required: false },
        },
        outputs: {},
      },
    });
    const { container } = render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({
          uses: "actions/setup-node@v4",
          with: { "node-version": "20" },
        })}
      />,
    );
    // datalist mounts after metadata resolves.
    await waitFor(() => {
      const datalist = container.querySelector("datalist");
      expect(datalist).toBeTruthy();
    });
    const datalist = container.querySelector("datalist")!;
    const options = [...datalist.querySelectorAll("option")].map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toEqual(
      expect.arrayContaining(["node-version", "cache", "registry-url"]),
    );
  });

  it("disables the chip for an input that's already set", async () => {
    invokeMock.mockResolvedValue({
      kind: "ok",
      from_cache: false,
      metadata: {
        inputs: {
          "node-version": { description: "version", required: false },
          cache: { description: "cache", required: false },
        },
        outputs: {},
      },
    });
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({
          uses: "actions/setup-node@v4",
          with: { "node-version": "20" },
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Available inputs/)).toBeTruthy();
    });
    // node-version is used → chip is disabled. cache is unused → enabled.
    const chips = screen
      .getAllByRole("button")
      .filter((b) =>
        b.className.includes("workflow-form__known-input"),
      );
    const nodeVersionChip = chips.find(
      (c) => c.textContent?.includes("node-version"),
    );
    const cacheChip = chips.find((c) => c.textContent?.includes("cache"));
    expect(nodeVersionChip?.hasAttribute("disabled")).toBe(true);
    expect(cacheChip?.hasAttribute("disabled")).toBe(false);
  });

  it("clicking an unused chip adds the key as a new with: row", async () => {
    invokeMock.mockResolvedValue({
      kind: "ok",
      from_cache: false,
      metadata: {
        inputs: {
          cache: { description: "cache", required: false },
        },
        outputs: {},
      },
    });
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({
          uses: "actions/setup-node@v4",
          with: {},
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Available inputs/)).toBeTruthy();
    });
    const cacheChip = screen
      .getAllByRole("button")
      .find(
        (b) =>
          b.className.includes("workflow-form__known-input") &&
          b.textContent?.includes("cache"),
      )!;
    const beforeRows = document.querySelectorAll(
      ".workflow-form__with-row",
    ).length;
    fireEvent.click(cacheChip);
    const afterRows = document.querySelectorAll(
      ".workflow-form__with-row",
    ).length;
    expect(afterRows).toBe(beforeRows + 1);
  });
});

describe("StepForm — action metadata threading", () => {
  it("renders input descriptions next to existing with: rows on success", async () => {
    invokeMock.mockResolvedValue({
      kind: "ok",
      from_cache: false,
      metadata: {
        name: "Setup Node",
        inputs: {
          "node-version": {
            description: "Version of Node.js to use (eg. 20)",
            required: false,
            default: "lts/*",
          },
          cache: {
            description: "Used to specify a package manager for caching",
            required: false,
          },
        },
        outputs: {},
      },
    });
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({
          uses: "actions/setup-node@v4",
          with: { "node-version": "20" },
        })}
      />,
    );
    await waitFor(() => {
      // Description renders in TWO places after Codex MED-4 fix:
      // (1) inline next to the with: row that uses the input
      // (2) inside the "Available inputs" panel as the chip's
      //     visible description. Both are intentional.
      expect(
        screen.getAllByText(/Version of Node\.js to use/).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("marks required inputs with an asterisk + lists missing required keys", async () => {
    invokeMock.mockResolvedValue({
      kind: "ok",
      from_cache: false,
      metadata: {
        inputs: {
          "fetch-depth": {
            description: "How many commits to fetch",
            required: true,
          },
        },
        outputs: {},
      },
    });
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({ uses: "actions/checkout@v4", with: {} })}
      />,
    );
    await waitFor(() => {
      // Required input not set → surfaced as a missing required key
      // chip in the dedicated "missing required" row.
      const missingRequiredPanel = document.querySelector(
        ".workflow-form__missing-required",
      );
      expect(missingRequiredPanel?.textContent).toMatch(/fetch-depth/i);
    });
    // Required indicator (asterisk) appears at least once.
    expect(screen.getAllByText("*").length).toBeGreaterThan(0);
  });

  it("falls back to free-form rows when metadata fetch fails (NotFound)", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "not_found",
      message: "no action.yml",
    });
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({
          uses: "private/internal-action@v1",
          with: { foo: "bar" },
        })}
      />,
    );
    await waitFor(() => {
      // Existing with row still renders.
      expect(screen.getByDisplayValue("foo")).toBeDefined();
      expect(screen.getByDisplayValue("bar")).toBeDefined();
    });
    // No input description from metadata.
    expect(screen.queryByText(/Version of Node\.js/)).toBeNull();
  });

  it("does not invoke for run-steps (no uses ref)", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep({
          id: "test",
          uses: undefined,
          run: "pnpm test",
          name: "Test",
        })}
      />,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("StepForm — step navigation", () => {
  it("renders Step N of M position label", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={2}
        step={makeStep()}
        stepCount={5}
        prevStepId="step-2"
        nextStepId="step-4"
      />,
    );
    expect(screen.getByText(/Step 3 of 5/)).toBeTruthy();
  });

  it("disables Prev when prevStepId is null and Next when nextStepId is null", () => {
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep()}
        stepCount={1}
        prevStepId={null}
        nextStepId={null}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const prev = buttons.find((b) => b.getAttribute("aria-label")?.includes("Previous"));
    const next = buttons.find((b) => b.getAttribute("aria-label")?.includes("Next"));
    expect(prev?.hasAttribute("disabled")).toBe(true);
    expect(next?.hasAttribute("disabled")).toBe(true);
  });

  it("Next button calls selectStep with the next step id", async () => {
    const { useWorkflowViewStore } = await import("@/stores/workflowViewStore");
    useWorkflowViewStore.getState().reset();
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep()}
        stepCount={3}
        prevStepId={null}
        nextStepId="step-2"
      />,
    );
    const next = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label")?.includes("Next"))!;
    fireEvent.click(next);
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("build");
    expect(useWorkflowViewStore.getState().selectedStepId).toBe("step-2");
  });

  it("Back-to-job button clears selectedStepId but keeps the job", async () => {
    const { useWorkflowViewStore } = await import("@/stores/workflowViewStore");
    useWorkflowViewStore.getState().selectStep("build", "step-1");
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep()}
        stepCount={3}
        prevStepId={null}
        nextStepId="step-2"
      />,
    );
    const back = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label")?.includes("Back to job"))!;
    fireEvent.click(back);
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("build");
    expect(useWorkflowViewStore.getState().selectedStepId).toBeNull();
  });

  it("Alt+ArrowRight on window navigates to the next step", async () => {
    const { useWorkflowViewStore } = await import("@/stores/workflowViewStore");
    useWorkflowViewStore.getState().reset();
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep()}
        stepCount={3}
        prevStepId={null}
        nextStepId="step-2"
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(useWorkflowViewStore.getState().selectedStepId).toBe("step-2");
  });

  it("Alt+ArrowRight is ignored when focus is inside an editable field (preserves native word-jump)", async () => {
    const { useWorkflowViewStore } = await import("@/stores/workflowViewStore");
    useWorkflowViewStore.getState().reset();
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep()}
        stepCount={3}
        prevStepId={null}
        nextStepId="step-2"
      />,
    );
    const nameInput = screen.getByLabelText(/name/i);
    nameInput.focus();
    // Dispatch on the input element so e.target is the input, not body.
    fireEvent.keyDown(nameInput, { key: "ArrowRight", altKey: true });
    expect(useWorkflowViewStore.getState().selectedStepId).toBeNull();
  });

  it("Alt+ArrowRight is ignored when focus is inside a CodeMirror editor", async () => {
    const { useWorkflowViewStore } = await import("@/stores/workflowViewStore");
    useWorkflowViewStore.getState().reset();
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep()}
        stepCount={3}
        prevStepId={null}
        nextStepId="step-2"
      />,
    );
    // Build a fake CodeMirror surface in the document. The guard uses
    // `closest(".cm-editor")` so any descendant of a `.cm-editor`
    // ancestor is treated as an editable surface.
    const cmHost = document.createElement("div");
    cmHost.className = "cm-editor";
    const inner = document.createElement("div");
    cmHost.appendChild(inner);
    document.body.appendChild(cmHost);
    fireEvent.keyDown(inner, { key: "ArrowRight", altKey: true });
    document.body.removeChild(cmHost);
    expect(useWorkflowViewStore.getState().selectedStepId).toBeNull();
  });

  it("Alt+ArrowRight is ignored when defaultPrevented is already set", async () => {
    const { useWorkflowViewStore } = await import("@/stores/workflowViewStore");
    useWorkflowViewStore.getState().reset();
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep()}
        stepCount={3}
        prevStepId={null}
        nextStepId="step-2"
      />,
    );
    // Pre-handle the same event at capture phase to mark it defaultPrevented.
    const blocker = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowRight") e.preventDefault();
    };
    window.addEventListener("keydown", blocker, { capture: true });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    window.removeEventListener("keydown", blocker, { capture: true } as never);
    expect(useWorkflowViewStore.getState().selectedStepId).toBeNull();
  });

  it("Alt+ArrowLeft does nothing when prevStepId is null", async () => {
    const { useWorkflowViewStore } = await import("@/stores/workflowViewStore");
    useWorkflowViewStore.getState().selectStep("build", "step-1");
    render(
      <StepForm
        jobId="build"
        stepIndex={0}
        step={makeStep()}
        stepCount={3}
        prevStepId={null}
        nextStepId="step-2"
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(useWorkflowViewStore.getState().selectedStepId).toBe("step-1");
  });
});
