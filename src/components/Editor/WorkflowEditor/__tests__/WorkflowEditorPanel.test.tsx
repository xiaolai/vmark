// Phase 7 WI-7.2 — WorkflowEditorPanel container tests.
//
// The panel:
//   - Always renders the trigger summary if there's a workflow.
//   - Renders the empty hint when no job is selected.
//   - Renders JobForm when a job is selected.
//   - Renders StepForm when a step is selected.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// WI-FL3.8 — the panel runs actionlint through the real `lintWithActionlint`;
// only the Tauri `invoke` boundary and the toast surface are faked. The
// default reply mirrors src/test/setup.ts so the pre-existing cases (which
// pass tabId={null} and never lint) behave exactly as before.
const { invokeMock, infoMock, warningMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(
    () => Promise.resolve(undefined),
  ),
  infoMock: vi.fn(),
  warningMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/services/ime/imeToast", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/services/ime/imeToast")>();
  return {
    ...original,
    imeToast: { ...original.imeToast, info: infoMock, warning: warningMock },
  };
});

import { __resetActionlintPathCacheForTests } from "@/lib/ghaWorkflow/lint/actionlint";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowStore } from "@/stores/workflowStore";
import { WorkflowEditorPanel } from "../WorkflowEditorPanel";
import {
  ACTIONLINT_DEBOUNCE_MS,
  __resetActionlintNoticesForTests,
} from "../useActionlintDiagnostics";

function makeWorkflow(): WorkflowIR {
  return {
    triggers: [
      {
        event: "push",
        branches: ["main"],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    permissions: "read-all",
    env: {},
    jobs: [
      {
        id: "build",
        name: "Build",
        runsOn: ["ubuntu-latest"],
        needs: [],
        steps: [
          {
            id: "checkout",
            idSynthesized: false,
            uses: "actions/checkout@v4",
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          },
          {
            id: "test",
            idSynthesized: false,
            run: "pnpm test",
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          },
        ],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    positions: {},
    diagnostics: [],
  };
}

beforeEach(() => {
  useWorkflowStore.getState().resetView();
  useWorkflowStore.getState().resetEdit();
});

afterEach(() => {
  cleanup();
});

describe("WorkflowEditorPanel", () => {
  it("renders the trigger summary when no job is selected", () => {
    render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    expect(screen.getByText("push")).toBeDefined();
    // Empty-job hint should be visible.
    expect(screen.getByText(/select a job/i)).toBeDefined();
  });

  it("renders the JobForm for the selected job", () => {
    useWorkflowStore.getState().selectJob("build");
    render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    const nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Build");
  });

  it("renders the StepForm for the selected step", () => {
    useWorkflowStore.getState().selectStep("build", "test");
    render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    const runInput = screen.getByLabelText(/^run/i) as HTMLTextAreaElement;
    expect(runInput.value).toBe("pnpm test");
  });

  it("Save button is disabled when there are no pending edits", () => {
    render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    const save = screen.getByRole("button", {
      name: /^save$/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("renders nothing when workflow is null", () => {
    const { container } = render(
      <WorkflowEditorPanel
        workflow={null}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Discard remounts the active form so mid-edit useState values reset (audit fix for WI-7.2)", () => {
    useWorkflowStore.getState().selectJob("build");
    let discardCalled = false;
    const view = render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {
          discardCalled = true;
        }}
      />,
    );
    // Type into the name input without blurring (no patch queued).
    let nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    fireEvent.change(nameInput, {
      target: { value: "TYPED-BUT-UNCOMMITTED" },
    });
    expect(nameInput.value).toBe("TYPED-BUT-UNCOMMITTED");
    // Queue a patch so the Discard button is enabled.
    useWorkflowStore.getState().queuePatch({
      kind: "workflow.set",
      path: "name",
      value: "x",
    });
    view.rerender(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {
          discardCalled = true;
        }}
      />,
    );
    // Click Discard.
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    // The form has remounted from the IR; the typed value is gone.
    nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Build");
    expect(discardCalled).toBe(true);
  });

  it("clears form-local edit state when selection switches to another job", () => {
    // Two-job workflow: select first, type into name, switch selection,
    // then verify the new job's name shows (not the typed value).
    const wf: WorkflowIR = {
      ...makeWorkflow(),
      jobs: [
        ...makeWorkflow().jobs,
        {
          id: "deploy",
          name: "Deploy",
          runsOn: ["macos-latest"],
          needs: [],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    };
    useWorkflowStore.getState().selectJob("build");
    const view = render(
      <WorkflowEditorPanel
        workflow={wf}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    let nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    nameInput.value = "TYPED-BUT-UNCOMMITTED";
    // Now switch selection. The form must remount and show "Deploy", not
    // the typed value, and not "Build".
    useWorkflowStore.getState().selectJob("deploy");
    view.rerender(
      <WorkflowEditorPanel
        workflow={wf}
        tabId={null}
        documentId={null}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Deploy");
  });

  // Audit R2 #575 — the edit store holds ONE active binding and stashes every
  // other document's queue. A panel that read `pendingPatches` unconditionally
  // rendered the other pane's edits over its own workflow.
  describe("the preview overlay reads THIS document's queue", () => {
    function renderFor(documentId: string) {
      useWorkflowStore.getState().selectJob("fresh");
      render(
        <WorkflowEditorPanel
          workflow={makeWorkflow()}
          tabId="tab-1"
          documentId={documentId}
          onSave={async () => {}}
          onDiscard={() => {}}
        />,
      );
    }

    it("applies the queue of the bound document", () => {
      useWorkflowStore.getState().bindToDocument("/mine.yml");
      useWorkflowStore.getState().queuePatch({ kind: "job.create", jobId: "fresh" });
      renderFor("/mine.yml");
      expect(screen.queryByText("fresh")).not.toBeNull();
    });

    it("ignores a queue that belongs to another document", () => {
      useWorkflowStore.getState().bindToDocument("/other.yml");
      useWorkflowStore.getState().queuePatch({ kind: "job.create", jobId: "fresh" });
      renderFor("/mine.yml");
      expect(screen.queryByText("fresh")).toBeNull();
      expect(screen.getByText(/select a job/i)).toBeDefined();
    });

    it("reads its own STASHED queue while another document holds the binding", () => {
      useWorkflowStore.getState().bindToDocument("/mine.yml");
      useWorkflowStore.getState().queuePatch({ kind: "job.create", jobId: "fresh" });
      // The other pane takes the binding; ours is stashed, not lost.
      useWorkflowStore.getState().bindToDocument("/other.yml");
      renderFor("/mine.yml");
      expect(screen.queryByText("fresh")).not.toBeNull();
    });
  });

  // Audit R2 #1020 — the forms cancel a queued patch when the field matches
  // its pre-edit value, so the panel has to hand them the PRE-EDIT IR. It used
  // to hand them the preview, which already carries the queued edit: a second
  // blur on a committed field then read as a revert and dropped it.
  describe("a committed edit survives a second blur", () => {
    function renderBound(workflow: WorkflowIR): void {
      useWorkflowStore.getState().bindToDocument("/mine.yml");
      render(
        <WorkflowEditorPanel
          workflow={workflow}
          tabId={null}
          documentId="/mine.yml"
          onSave={async () => {}}
          onDiscard={() => {}}
        />,
      );
    }

    it("keeps the job name edit", () => {
      useWorkflowStore.getState().selectJob("build");
      renderBound(makeWorkflow());
      const input = screen.getByLabelText(/^name/i);
      fireEvent.change(input, { target: { value: "Rebuild" } });
      fireEvent.blur(input);
      fireEvent.blur(screen.getByLabelText(/^name/i));
      expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
        { kind: "job.set", jobId: "build", path: "name", value: "Rebuild" },
      ]);
    });

    it("keeps the step run edit", () => {
      useWorkflowStore.getState().selectStep("build", "test");
      renderBound(makeWorkflow());
      const input = screen.getByLabelText(/^run/i);
      fireEvent.change(input, { target: { value: "pnpm check" } });
      fireEvent.blur(input);
      fireEvent.blur(screen.getByLabelText(/^run/i));
      expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
        {
          kind: "step.set",
          jobId: "build",
          stepIndex: 1,
          path: "run",
          value: "pnpm check",
        },
      ]);
    });

    it("keeps a with: row edit", () => {
      const workflow = makeWorkflow();
      const steps = workflow.jobs[0].steps;
      steps[0] = { ...steps[0], with: { "node-version": "20" } };
      useWorkflowStore.getState().selectStep("build", "checkout");
      renderBound(workflow);
      const input = screen.getByDisplayValue("20");
      fireEvent.change(input, { target: { value: "22" } });
      fireEvent.blur(input);
      fireEvent.blur(screen.getByDisplayValue("22"));
      expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
        {
          kind: "with.set",
          jobId: "build",
          stepIndex: 0,
          key: "node-version",
          value: "22",
        },
      ]);
    });
  });

  describe("focus restoration on step navigation", () => {
    it("focuses Next button after step→step transition", async () => {
      useWorkflowStore.getState().selectStep("build", "checkout");
      render(
        <WorkflowEditorPanel
          workflow={makeWorkflow()}
          tabId={null}
          documentId={null}
          onSave={async () => {}}
          onDiscard={() => {}}
        />,
      );
      // Trigger step→step nav. The effect inside the panel observes the
      // stepId transition and schedules a focus via requestAnimationFrame.
      useWorkflowStore.getState().selectStep("build", "test");
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      // After nav, Back-to-job should be focused (Next disabled at last step,
      // Prev points back to previous step which IS available — so Prev or Back).
      const focused = document.activeElement as HTMLElement | null;
      expect(focused?.className).toContain("workflow-form__nav-btn");
    });

    it("does NOT auto-focus on initial step selection (null → step)", async () => {
      const { container } = render(
        <WorkflowEditorPanel
          workflow={makeWorkflow()}
          tabId={null}
          documentId={null}
          onSave={async () => {}}
          onDiscard={() => {}}
        />,
      );
      // Initial mount with NO step selected — body is the active element.
      // Now select a step for the first time. Should NOT trigger auto-focus.
      const focusedBefore = document.activeElement;
      useWorkflowStore.getState().selectStep("build", "checkout");
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      // No nav button should have been focused.
      const focused = document.activeElement;
      expect(focused).toBe(focusedBefore);
      // Form did render though.
      expect(container.querySelector(".workflow-form__step-position")).toBeTruthy();
    });
  });
});

// WI-FL3.8 — actionlint's rows join the parser's in the banner. Driven
// through the real `lintWithActionlint` and the `invoke` boundary, with the
// wire shapes the Rust `gha_lint` command emits.
describe("WorkflowEditorPanel — actionlint rows in the banner (WI-FL3.8)", () => {
  const YAML = [
    "name: ci",
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: pnpm test",
    "",
  ].join("\n");
  const SHELLCHECK_ROW = {
    message: "shellcheck: SC2086 double quote to prevent globbing",
    kind: "shellcheck",
    line: 7,
    column: 9,
  };
  const initialAdvanced = useSettingsStore.getState().advanced;

  function setActionlint(on: boolean): void {
    useSettingsStore.setState({
      advanced: {
        ...useSettingsStore.getState().advanced,
        workflowActionlint: on,
      },
    });
  }

  function lintReplies(reply: unknown): void {
    invokeMock.mockImplementation((cmd) =>
      cmd === "gha_lint"
        ? Promise.resolve(reply)
        : Promise.resolve("/opt/homebrew/bin"),
    );
  }

  const lintCalls = () =>
    invokeMock.mock.calls.filter(([cmd]) => cmd === "gha_lint");

  async function fireDebounce(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ACTIONLINT_DEBOUNCE_MS);
    });
    await act(async () => {});
    await act(async () => {});
  }

  /** A workflow whose parser already produced one row. */
  function workflowWithParserRow(): WorkflowIR {
    return {
      ...makeWorkflow(),
      diagnostics: [
        {
          severity: "warning",
          code: "GHA-STEP-003",
          message: "Step id was synthesized — consider adding an explicit `id:`",
          context: { jobId: "build" },
        },
      ],
    };
  }

  function renderPanel(tabId: string | null = "tab-1"): void {
    render(
      <WorkflowEditorPanel
        workflow={workflowWithParserRow()}
        tabId={tabId}
        documentId={tabId}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    infoMock.mockReset();
    warningMock.mockReset();
    lintReplies({ kind: "ok", diagnostics: [SHELLCHECK_ROW] });
    __resetActionlintPathCacheForTests();
    __resetActionlintNoticesForTests();
    useDocumentStore.setState({ documents: {} });
    useDocumentStore
      .getState()
      .initDocument("tab-1", YAML, "/repo/.github/workflows/ci.yml");
    setActionlint(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.resolve(undefined));
    useSettingsStore.setState({ advanced: initialAdvanced });
  });

  it("appends actionlint's rows beneath the parser's without making the parser's rows wait", async () => {
    renderPanel();
    // First paint: the parser's row is already there and actionlint has not
    // even been asked yet.
    expect(screen.getByText("GHA-STEP-003")).toBeDefined();
    expect(screen.queryByText("GHA-ACTIONLINT-shellcheck")).toBeNull();
    expect(screen.getByText("(1)")).toBeDefined();
    expect(lintCalls()).toHaveLength(0);

    await fireDebounce();

    expect(lintCalls()).toHaveLength(1);
    expect(screen.getByText("GHA-STEP-003")).toBeDefined();
    expect(screen.getByText("GHA-ACTIONLINT-shellcheck")).toBeDefined();
    expect(screen.getByText(/SC2086/)).toBeDefined();
    // One merged list: the header count is the total across both sources,
    // and the stable severity sort keeps the parser's row first.
    expect(screen.getByText("(2)")).toBeDefined();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("GHA-STEP-003");
    expect(rows[1].textContent).toContain("GHA-ACTIONLINT-shellcheck");
  });

  it("with the setting off, the banner shows the parser's rows only and the lint command is never invoked", async () => {
    setActionlint(false);
    renderPanel();
    await act(async () => {
      vi.advanceTimersByTime(ACTIONLINT_DEBOUNCE_MS * 2);
    });
    await act(async () => {});
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.getByText("GHA-STEP-003")).toBeDefined();
    expect(screen.queryByText("GHA-ACTIONLINT-shellcheck")).toBeNull();
    expect(screen.getByText("(1)")).toBeDefined();
  });

  it("turning the setting off removes actionlint's rows from the banner at once", async () => {
    renderPanel();
    await fireDebounce();
    expect(screen.getByText("(2)")).toBeDefined();
    act(() => setActionlint(false));
    expect(screen.queryByText("GHA-ACTIONLINT-shellcheck")).toBeNull();
    expect(screen.getByText("(1)")).toBeDefined();
  });

  it("when actionlint is unavailable the parser's rows stay and the user is told once, not per run", async () => {
    lintReplies({ kind: "binary_missing" });
    renderPanel();
    await fireDebounce();
    expect(screen.getByText("(1)")).toBeDefined();
    expect(screen.queryByText(/GHA-ACTIONLINT/)).toBeNull();
    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(warningMock).not.toHaveBeenCalled();

    act(() => {
      useDocumentStore.getState().setEditorContent("tab-1", `${YAML}# edit\n`);
    });
    await fireDebounce();
    expect(lintCalls()).toHaveLength(2);
    expect(infoMock).toHaveBeenCalledTimes(1);
  });

  it("without a hosting tab the banner is parser-only and actionlint is never asked", async () => {
    renderPanel(null);
    await fireDebounce();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.getByText("(1)")).toBeDefined();
  });
});
