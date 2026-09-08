// Phase 7 WI-7.1 — JobForm tests.
//
// Tests cover:
//   1. Read display: name, runs-on, if, needs[], step count surface for
//      the selected job.
//   2. Edit emit: changing a field queues an IRPatch in workflowEditStore.
//   3. Field semantics: empty string clears the field (vs queueing an
//      empty value patch); runs-on splits on " / ".

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { JobIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowStore } from "@/stores/workflowStore";
import { JobForm } from "../JobForm";

function makeJob(overrides: Partial<JobIR> = {}): JobIR {
  return {
    id: "build",
    name: "Build",
    runsOn: ["ubuntu-latest"],
    needs: [],
    steps: [],
    if: undefined,
    position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  useWorkflowStore.getState().resetEdit();
  useWorkflowStore.getState().resetView();
});

afterEach(() => {
  cleanup();
});

describe("JobForm — display", () => {
  it("shows the job name as the editable label", () => {
    render(<JobForm job={makeJob({ name: "Build" })} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(input.value).toBe("Build");
  });

  it("falls back to the job id when name is undefined", () => {
    render(<JobForm job={makeJob({ name: undefined })} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    // Empty input — name field is undefined; id is shown elsewhere.
    expect(input.value).toBe("");
    // The job id is shown as a read-only header.
    expect(screen.getByText(/build/i)).toBeDefined();
  });

  it("joins runsOn array with ' / ' for display", () => {
    render(
      <JobForm job={makeJob({ runsOn: ["self-hosted", "linux", "x64"] })} />,
    );
    const input = screen.getByLabelText(/runs.?on/i) as HTMLInputElement;
    expect(input.value).toBe("self-hosted / linux / x64");
  });

  it("renders the if condition when present", () => {
    render(<JobForm job={makeJob({ if: "github.event_name == 'push'" })} />);
    const input = screen.getByLabelText(/condition|^if/i) as HTMLInputElement;
    expect(input.value).toBe("github.event_name == 'push'");
  });

  it("shows the step count and needs[] as read-only summary", () => {
    render(
      <JobForm
        job={makeJob({
          needs: ["lint", "format"],
          steps: [
            {
              id: "s1",
              idSynthesized: false,
              run: "echo hi",
              position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            },
            {
              id: "s2",
              idSynthesized: false,
              run: "echo ok",
              position: { startLine: 2, startCol: 1, endLine: 2, endCol: 1 },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/2 steps/i)).toBeDefined();
    expect(screen.getByText(/lint/)).toBeDefined();
    expect(screen.getByText(/format/)).toBeDefined();
  });
});

describe("JobForm — edits emit IRPatches", () => {
  it("queues a job.set patch when name changes", () => {
    render(<JobForm job={makeJob()} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Build the App" } });
    fireEvent.blur(input);
    const patches = useWorkflowStore.getState().edit.pendingPatches;
    expect(patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      kind: "job.set",
      jobId: "build",
      path: "name",
      value: "Build the App",
    });
  });

  it("queues a job.set patch with a single string when runs-on is one label", () => {
    render(<JobForm job={makeJob()} />);
    const input = screen.getByLabelText(/runs.?on/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "macos-latest" } });
    fireEvent.blur(input);
    const patches = useWorkflowStore.getState().edit.pendingPatches;
    expect(patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      kind: "job.set",
      jobId: "build",
      path: "runs-on",
      value: "macos-latest",
    });
  });

  it("queues a job.set patch with an array when runs-on is multi-label (audit fix)", () => {
    render(<JobForm job={makeJob()} />);
    const input = screen.getByLabelText(/runs.?on/i) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "self-hosted / linux / x64" },
    });
    fireEvent.blur(input);
    const patches = useWorkflowStore.getState().edit.pendingPatches;
    expect(patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      kind: "job.set",
      jobId: "build",
      path: "runs-on",
      value: ["self-hosted", "linux", "x64"],
    });
  });

  it("queues a job.set patch when if changes", () => {
    render(<JobForm job={makeJob()} />);
    const input = screen.getByLabelText(/condition|^if/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "github.ref == 'refs/heads/main'" } });
    fireEvent.blur(input);
    const patches = useWorkflowStore.getState().edit.pendingPatches;
    expect(patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      kind: "job.set",
      jobId: "build",
      path: "if",
      value: "github.ref == 'refs/heads/main'",
    });
  });

  it("does not queue a patch when the value is unchanged", () => {
    render(<JobForm job={makeJob({ name: "Build" })} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    fireEvent.blur(input); // No change before blur.
    expect(useWorkflowStore.getState().edit.pendingPatches.length).toBe(0);
  });
});

describe("JobForm — step navigation", () => {
  it("renders each step as a clickable row when steps exist", () => {
    render(
      <JobForm
        job={makeJob({
          steps: [
            {
              id: "checkout",
              idSynthesized: false,
              uses: "actions/checkout@v4",
              name: "Checkout",
              position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            },
            {
              id: "test",
              idSynthesized: false,
              run: "pnpm test",
              position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /checkout/i })).toBeDefined();
    // run-step shows the id since name is missing
    expect(screen.getByRole("button", { name: /\btest\b/i })).toBeDefined();
  });

  it("clicking a step row calls selectStep on the workflow view store", () => {
    render(
      <JobForm
        job={makeJob({
          steps: [
            {
              id: "checkout",
              idSynthesized: false,
              uses: "actions/checkout@v4",
              name: "Checkout",
              position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    const view = useWorkflowStore.getState().view;
    expect(view.selectedJobId).toBe("build");
    expect(view.selectedStepId).toBe("checkout");
  });

  it("does not render the step-list section when there are no steps", () => {
    render(<JobForm job={makeJob({ steps: [] })} />);
    expect(screen.queryByText(/step navigation/i)).toBeNull();
  });
});

// Audit R2 #1020 — the "unchanged → cancel the queued patch" branch has to
// compare against the PRE-EDIT job. The panel feeds `job` from the preview
// overlay, which already carries this job's queued job.set, so a second blur
// on a committed field read as a revert and silently dropped the edit.
describe("JobForm — the revert baseline is the pre-edit job", () => {
  function parsed(): JobIR {
    return makeJob({
      name: "Build",
      runsOn: ["ubuntu-latest"],
      if: "github.event_name == 'push'",
    });
  }

  it("keeps a committed name edit when the field is blurred again", () => {
    const original = parsed();
    const { rerender } = render(<JobForm job={original} baseline={original} />);
    const input = screen.getByLabelText(/name/i);
    fireEvent.change(input, { target: { value: "Build the App" } });
    fireEvent.blur(input);
    // What the panel renders next: `job` becomes the PREVIEW job (the queued
    // edit applied), while the baseline stays the parsed one.
    rerender(
      <JobForm
        job={{ ...original, name: "Build the App" }}
        baseline={original}
      />,
    );
    fireEvent.blur(screen.getByLabelText(/name/i));
    expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
      { kind: "job.set", jobId: "build", path: "name", value: "Build the App" },
    ]);
  });

  it("keeps a committed runs-on edit when the field is blurred again", () => {
    const original = parsed();
    const { rerender } = render(<JobForm job={original} baseline={original} />);
    const input = screen.getByLabelText(/runs.?on/i);
    fireEvent.change(input, { target: { value: "macos-latest" } });
    fireEvent.blur(input);
    rerender(
      <JobForm
        job={{ ...original, runsOn: ["macos-latest"] }}
        baseline={original}
      />,
    );
    fireEvent.blur(screen.getByLabelText(/runs.?on/i));
    expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
      { kind: "job.set", jobId: "build", path: "runs-on", value: "macos-latest" },
    ]);
  });

  it("keeps a committed if edit when the field is blurred again", () => {
    const original = parsed();
    const { rerender } = render(<JobForm job={original} baseline={original} />);
    const input = screen.getByLabelText(/condition|^if/i);
    fireEvent.change(input, { target: { value: "github.ref == 'main'" } });
    fireEvent.blur(input);
    rerender(
      <JobForm
        job={{ ...original, if: "github.ref == 'main'" }}
        baseline={original}
      />,
    );
    fireEvent.blur(screen.getByLabelText(/condition|^if/i));
    expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
      { kind: "job.set", jobId: "build", path: "if", value: "github.ref == 'main'" },
    ]);
  });

  it("still cancels the patch when the pre-edit value is typed back", () => {
    const original = parsed();
    const { rerender } = render(<JobForm job={original} baseline={original} />);
    const input = screen.getByLabelText(/name/i);
    fireEvent.change(input, { target: { value: "Build the App" } });
    fireEvent.blur(input);
    rerender(
      <JobForm
        job={{ ...original, name: "Build the App" }}
        baseline={original}
      />,
    );
    const reopened = screen.getByLabelText(/name/i);
    fireEvent.change(reopened, { target: { value: "Build" } });
    fireEvent.blur(reopened);
    expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([]);
  });
});
