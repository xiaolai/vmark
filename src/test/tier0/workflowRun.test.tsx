// WI-RA14C.5 — a workflow run, end to end: Run dispatches `run_workflow` with
// the document's YAML, the workspace root, a fresh execution id, the provider
// block and the capture policy → the runner's step frames move the steps the
// panel paints → the complete frame ends the run and frees the window's slot.
//
// REAL: the yaml adapter's engine renderer with its run panel and step graph,
// the approval dialog (the window's event owner, as in the app), the workflow
// / document / workspace / provider / settings stores, the dispatch
// transaction and the event subscription, on a `.yml` document opened through
// the real open path.
// FAKED: `@tauri-apps/*` only — the stateful in-memory disk with NAMED command
// stubs behind `invoke` (an unstubbed command rejects), a handler registry
// behind `listen` — plus sonner, the toast renderer. Status text is asserted
// as `workflow:` i18n keys: the test i18n map does not load that namespace.
// Left to the real-app journey (e2e/journeys/44-workflow-execution.mjs): the
// Rust runner itself — admission, the engine gate, steps and their files.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";

const bridge = vi.hoisted(() => ({ handlers: new Map<string, Set<(frame: never) => void>>() }));

vi.mock("@tauri-apps/plugin-fs", async () => (await import("@/test/statefulFsFake")).statefulFs.fsModule());
vi.mock("@tauri-apps/api/core", async () => (await import("@/test/statefulFsFake")).statefulFs.coreModule());
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: (frame: never) => void) => {
    const registered = bridge.handlers.get(event) ?? new Set();
    bridge.handlers.set(event, registered.add(handler));
    return Promise.resolve(() => void registered.delete(handler));
  }),
  emit: vi.fn(() => Promise.resolve()),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

import { EngineWorkflowSchemaRenderer } from "@/lib/formats/adapters/yamlEngineRenderer";
import { ApprovalDialog } from "@/components/WorkflowApproval/ApprovalDialog";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAiProviderStore } from "@/stores/aiStore";
import { dispatchWorkflowRun } from "@/services/workflow/dispatchWorkflowRun";
import { resetWorkflowEvents } from "@/services/workflow/workflowRunEvents";
import { bootstrapFormats } from "@/lib/formats/registryBootstrap";
import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, doc, openDocInTab, resetTier0 } from "./harness";

const DOC = `${ROOT}/flow.yml`;
/** Two action steps; CJK in a name and a value must reach Rust byte for byte. */
const YAML = "name: 流程\nsteps:\n  - id: greet\n    uses: action/notify\n    with:\n      message: 你好\n  - id: save\n    uses: action/save-file\n    with:\n      path: out.md\n      input: ${{ steps.greet.outputs.text }}\n";
const OPENAI = { type: "openai" as const, name: "OpenAI", endpoint: "https://api.openai.com/v1", apiKey: "sk-test", model: "gpt-4" };
const initialWorkflow = useWorkflowStore.getState();

/** Every Rust command the flow reached, in order. */
let calls: Array<{ cmd: string; args: Record<string, unknown> }>;
let tabId: string;

function stub(cmd: string, answer: (args: Record<string, unknown>) => unknown): void {
  statefulFs.stubCommand(cmd, (args) => {
    calls.push({ cmd, args });
    return answer(args);
  });
}
const callsOf = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

/** Let pending promise chains and effects run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/** Open the workflow file and mount what the app mounts for it. */
async function mountPanel(content = YAML, { eventOwner = true } = {}): Promise<void> {
  tabId = await openDocInTab(DOC, content);
  render(
    <>
      {eventOwner && <ApprovalDialog />}
      <EngineWorkflowSchemaRenderer content={content} liveContent={content} path={DOC} diagnostics={[]} tabId={tabId} />
    </>,
  );
  await settle();
}

const BUTTON_NAME = { start: "Run workflow", cancel: "Cancel workflow" } as const;
const button = (key: "start" | "cancel") => screen.getByRole("button", { name: BUTTON_NAME[key] });
const statusLine = () => screen.queryByRole("status")?.textContent ?? null;
const preview = () => useWorkflowStore.getState().preview;
const executionId = () => String(callsOf("run_workflow").at(-1)?.executionId);

async function click(key: "start" | "cancel", times = 1): Promise<void> {
  act(() => {
    for (let i = 0; i < times; i++) fireEvent.click(button(key));
  });
  await settle();
}

/** Deliver one runner frame to the window's subscription. */
function emit(event: "step-update" | "complete", payload: Record<string, unknown>): void {
  const handlers = [...(bridge.handlers.get(`workflow:${event}`) ?? [])] as Array<(frame: { payload: unknown }) => void>;
  if (handlers.length === 0) throw new Error(`nothing listens for workflow:${event}`);
  act(() => handlers.forEach((handler) => handler({ payload: { executionId: executionId(), ...payload } })));
}

/** What the step graph paints for one step: its status class, or "pending". */
function shown(stepId: string): string {
  const node = document.querySelector(`.react-flow__node[data-id="${stepId}"] .workflow-node`);
  if (!node) throw new Error(`step ${stepId} is not on the graph: ${document.querySelector(".react-flow")?.innerHTML.slice(0, 1500)}`);
  return /workflow-node--(running|success|error|skipped)/.exec(node.className)?.[1] ?? "pending";
}

beforeAll(() => {
  bootstrapFormats();
  // jsdom gap the step graph (xyflow) reaches; a no-op observer is enough.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

beforeEach(() => {
  vi.clearAllMocks();
  bridge.handlers.clear();
  calls = [];
  resetTier0();
  resetWorkflowEvents();
  useWorkflowStore.setState(initialWorkflow, true);
  useAiProviderStore.setState({ activeProvider: "openai", cliProviders: [], restProviders: [OPENAI] });
  stub("run_workflow", (args) => args.executionId);
  stub("cancel_workflow", () => undefined);
  stub("list_workflow_snapshots", () => []);
});

afterEach(() => {
  cleanup();
  resetWorkflowEvents();
});

describe("a workflow run from the panel", () => {
  it("dispatches the document, shows each step's progress, and frees the slot when the run completes", async () => {
    await mountPanel();
    expect([shown("greet"), shown("save"), statusLine()]).toEqual(["pending", "pending", null]);

    await click("start");

    expect(callsOf("run_workflow")).toEqual([{
      yaml: YAML,
      env: {},
      workspaceRoot: ROOT,
      provider: { provider: "openai", apiKey: "sk-test", endpoint: "https://api.openai.com/v1", cliPath: null },
      executionId: preview().executionId,
      capturePolicy: "tracked-only",
    }]);
    expect(executionId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(statusLine()).toBe("Running…");

    emit("step-update", { stepId: "greet", status: "running" });
    expect([shown("greet"), shown("save")]).toEqual(["running", "pending"]);
    emit("step-update", { stepId: "greet", status: "success", output: "你好", duration: 4 });
    emit("step-update", { stepId: "save", status: "running" });
    expect([shown("greet"), shown("save")]).toEqual(["success", "running"]);
    emit("step-update", { stepId: "save", status: "success", output: "Saved to out.md", duration: 1500 });
    emit("complete", { status: "completed" });
    await settle();

    expect([shown("greet"), shown("save")]).toEqual(["success", "success"]);
    expect(screen.getByText("1.5s")).toBeInTheDocument();
    expect(statusLine()).toBe("Completed");
    expect(preview().executionId).toBeNull();

    // The slot is free: a second run starts under a NEW id, from a clean slate.
    const first = executionId();
    await click("start");
    expect(callsOf("run_workflow")).toHaveLength(2);
    expect(executionId()).not.toBe(first);
    expect([shown("greet"), shown("save"), statusLine()]).toEqual(["pending", "pending", "Running…"]);
  });

  it("ignores frames that belong to a different execution", async () => {
    await mountPanel();
    await click("start");

    emit("step-update", { executionId: "someone-else", stepId: "greet", status: "error", error: "not ours" });
    emit("complete", { executionId: "someone-else", status: "failed" });

    expect([shown("greet"), statusLine()]).toEqual(["pending", "Running…"]);
    expect(preview().executionId).toBe(executionId());
  });

  it("keeps frames that arrive before run_workflow resolves", async () => {
    let admit!: (id: unknown) => void;
    await mountPanel();
    stub("run_workflow", (args) => new Promise((resolve) => { admit = () => resolve(args.executionId); }));
    await click("start");

    emit("step-update", { stepId: "greet", status: "success", duration: 2 });
    emit("complete", { status: "completed" });
    expect([shown("greet"), statusLine()]).toEqual(["success", "Starting…"]);
    admit(null);
    await settle();

    expect([shown("greet"), statusLine()]).toEqual(["success", "Completed"]);
    expect(preview().executionId).toBeNull();
  });

  it("shows a failed step's error and the failed outcome", async () => {
    await mountPanel();
    await click("start");

    emit("step-update", { stepId: "greet", status: "success", duration: 3 });
    emit("step-update", { stepId: "save", status: "error", error: "Failed to write 'out.md': 磁盘已满", duration: 9 });
    emit("complete", { status: "failed" });

    expect([shown("greet"), shown("save")]).toEqual(["success", "error"]);
    expect(screen.getByTitle("Failed to write 'out.md': 磁盘已满")).toHaveTextContent("✗");
    expect(statusLine()).toBe("Failed");
  });

  it("Cancel reaches cancel_workflow with the run's id, and the runner's verdict ends the run", async () => {
    await mountPanel();
    await click("start");
    const id = executionId();

    await click("cancel");

    expect(callsOf("cancel_workflow")).toEqual([{ executionId: id }]);
    expect(statusLine()).toBe("Running…"); // still the runner's to end
    emit("complete", { status: "cancelled" });
    expect(statusLine()).toBe("Cancelled");
    expect(button("start")).toBeEnabled();
  });
});

describe("a workflow run that must not start", () => {
  it("a rejected run_workflow says why and clears the slot for the next run", async () => {
    await mountPanel();
    stub("run_workflow", () => Promise.reject({ code: "feature-disabled", message: "The workflow engine is turned off in Settings" }));

    await click("start");

    expect(toast.error).toHaveBeenCalledWith(
      "The workflow could not start",
      expect.objectContaining({ description: "The workflow engine is turned off in Settings" }),
    );
    expect(preview().executionId).toBeNull();
    expect(statusLine()).toBeNull();

    stub("run_workflow", (args) => args.executionId);
    await click("start");
    expect(statusLine()).toBe("Running…");
  });

  it("while one run is live a second dispatch is refused and never reaches Rust", async () => {
    await mountPanel();
    await click("start", 2); // a double click on Run

    expect(callsOf("run_workflow")).toHaveLength(1);
    // Another surface in the window (a workflow genie) asking for the same slot.
    await expect(dispatchWorkflowRun({ yaml: YAML, workspaceRoot: ROOT, provider: null })).resolves.toEqual({ status: "already-running" });
    expect(callsOf("run_workflow")).toHaveLength(1);
    expect(preview().executionId).toBe(executionId());
  });

  it("without an event owner the start is refused loudly, not run unobserved", async () => {
    await mountPanel(YAML, { eventOwner: false });

    await click("start");

    expect(toast.error).toHaveBeenCalledWith(
      "The workflow could not start",
      expect.objectContaining({ description: expect.stringContaining("No workflow event owner is mounted") }),
    );
    expect(calls).toEqual([]);
    expect(preview().executionId).toBeNull();
  });

  it.each([
    ["no workspace", YAML, null, "Open a folder to run this workflow"],
    ["an empty document", "", ROOT, null],
    ["a document that is not a workflow", "name: 流程\n", ROOT, null],
  ])("%s: Run is disabled and nothing is dispatched", async (_case, content, root, status) => {
    useWorkspaceStore.setState({ rootPath: root });
    await mountPanel(content);

    expect(button("start")).toBeDisabled();
    expect(statusLine()).toBe(status);
    fireEvent.click(button("start"));
    await settle();
    expect(callsOf("run_workflow")).toEqual([]);
  });

  it("an action-only run needs no AI provider: the block is null", async () => {
    useAiProviderStore.setState({ activeProvider: null });
    await mountPanel();

    await click("start");

    expect(callsOf("run_workflow")[0]).toMatchObject({ provider: null, yaml: doc(tabId).content });
  });
});
