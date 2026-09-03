/**
 * MCP v2 browser workflow handlers (WI-NB6.3) — the async run surface.
 *
 * `workflow_run` (act-class) validates and STARTS a run, returning a `runId`
 * immediately: a run outlives the bridge's ~20s request bound, so it executes
 * detached and the model polls `workflow_status` (read-class) and may
 * `workflow_cancel` (act-class, never approval-gated — stopping is always
 * allowed). The run itself authorizes every act it performs individually, so
 * `workflow_run` needs no new authorization token — it is orchestration.
 *
 * Status contract (D1v2, audit 2026-09-03 W-09): `{runId, status, stepCount,
 * firstStep, completedSteps, skippedSteps, pausedAt?, reasonCode?, reason?,
 * pendingApproval?, resumedFrom?, stepResults, url}`; the run response carries
 * `firstStep`. `resumeRunId` continues a paused run (W-05). Cancel answers
 * `RUN_NOT_FOUND` for an unknown run and `already-terminal` for a finished one
 * (W-08). A `navigate to` step's loaded page is mirrored onto the tab record so
 * the next step sees the new generation (W-02).
 *
 * @coordinates-with services/workflow/workflowRunService.ts — the orchestrator
 * @module services/mcpBridge/v2/browserWorkflow
 */

import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { browserGate } from "./browserAccess";
import { readTabIdArg, resolveBrowserTab } from "./browserHelpers";
import { urlForAgent } from "@/lib/browser/url";
import { useTabStore } from "@/stores/tabStore";

// Lazy-loaded: the workflow run engine (executor, registry, reader, sites,
// selfHeal, …) is only reached when the AI drives a workflow, so it is a
// dynamic import — it must not weigh down the eager app bundle that every user
// loads whether or not they ever touch the AI browser.
const workflowService = () => import("@/services/workflow/workflowRunService");

/** Own-property record of string inputs, or null when malformed. Built on a
 *  null prototype so a `__proto__` / `constructor` key is an ordinary input name
 *  (refused downstream as undeclared) rather than a prototype write. */
function readInputs(raw: unknown): Record<string, string> | null {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(raw)) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string") return null;
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** `vmark.browser.workflow_run` — start a run; returns {runId, steps, firstStep}. */
export async function handleBrowserWorkflowRun(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    // The same gate as every other browser handler: UNSUPPORTED_PLATFORM before
    // BROWSER_DISABLED, so an off-macOS client learns why instead of receiving a
    // runId for a run that fails in the background.
    if (!(await browserGate(id))) return;
    if (typeof args.source !== "string" || args.source.trim() === "") {
      await respond({ id, success: false, error: "workflow_run requires a non-empty `source`" });
      return;
    }
    const inputs = readInputs(args.inputs);
    if (inputs === null) {
      await respond({ id, success: false, error: "`inputs` must be an object of string values" });
      return;
    }
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null) {
      await respond({ id, success: false, error: "tabId must be a non-empty string when supplied" });
      return;
    }
    const tab = resolveBrowserTab(tabIdArg);
    if (!tab) {
      await respond({ id, success: false, error: "no active browser tab" });
      return;
    }
    if (tab.automationMode === "human") {
      await respond({ id, success: false, error: "TAB_NOT_AI_OWNED" });
      return;
    }
    const { startWorkflowRun } = await workflowService();
    const result = startWorkflowRun(args.source, {
      tabId: tab.tabId,
      resolveTab: () => {
        const t = resolveBrowserTab(tab.tabId);
        return t ? { url: t.url, generation: t.generation } : null;
      },
      inputs,
      // The store ignores an older generation, so this never regresses a tab the
      // surface's own navigation mirror already advanced.
      onNavigated: ({ url, generation }) => useTabStore.getState().updateBrowserTab(tab.tabId, { url, generation }),
      ...(args.allowRepeat === true ? { allowRepeat: true } : {}),
      ...(typeof args.resumeRunId === "string" && args.resumeRunId !== "" ? { resumeRunId: args.resumeRunId } : {}),
    });
    if (!result.ok) {
      await respond({ id, success: false, error: result.error });
      return;
    }
    await respond({
      id,
      success: true,
      data: { runId: result.runId, steps: result.steps, firstStep: result.firstStep, status: "running" },
    });
  });
}

/** `vmark.browser.workflow_status` — the current state of a run. */
export async function handleBrowserWorkflowStatus(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    // Deliberately NOT gated on the browser setting: observing a run is never the
    // thing a feature gate should refuse, and a run that outlived a disable must
    // stay inspectable (the same rule 60-ai-governance §12 states for stopping).
    if (typeof args.runId !== "string" || args.runId === "") {
      await respond({ id, success: false, error: "workflow_status requires a `runId`" });
      return;
    }
    const { workflowRunStatus } = await workflowService();
    const state = workflowRunStatus(args.runId);
    if (state === null) {
      await respond({ id, success: false, error: "RUN_NOT_FOUND" });
      return;
    }
    await respond({
      id,
      success: true,
      data: {
        runId: state.runId,
        status: state.status,
        stepCount: state.stepCount,
        firstStep: state.firstStep,
        completedSteps: state.completedSteps,
        skippedSteps: state.skippedSteps,
        ...(state.pausedAt !== undefined ? { pausedAt: state.pausedAt } : {}),
        ...(state.reasonCode !== undefined ? { reasonCode: state.reasonCode } : {}),
        ...(state.reason !== undefined ? { reason: state.reason } : {}),
        ...(state.pendingApproval !== undefined ? { pendingApproval: state.pendingApproval } : {}),
        ...(state.resumedFrom !== undefined ? { resumedFrom: state.resumedFrom } : {}),
        stepResults: state.stepResults,
        url: urlForAgent(resolveBrowserTab(state.tabId)?.url ?? ""),
      },
    });
  });
}

/** `vmark.browser.workflow_cancel` — stop a run (never approval-gated). */
export async function handleBrowserWorkflowCancel(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    // Never gated: "stop" must always be allowed. Refusing it while the setting is
    // off made a detached run unmanageable after policy teardown — the exact
    // failure §12 of 60-ai-governance records for the Rust gate.
    if (typeof args.runId !== "string" || args.runId === "") {
      await respond({ id, success: false, error: "workflow_cancel requires a `runId`" });
      return;
    }
    const { cancelWorkflowRun } = await workflowService();
    const result = cancelWorkflowRun(args.runId);
    if (result.outcome === "not-found") {
      await respond({ id, success: false, error: "RUN_NOT_FOUND" });
      return;
    }
    await respond({
      id,
      success: true,
      data: {
        runId: args.runId,
        status: result.outcome === "cancelled" ? "cancelled" : result.status,
        result: result.outcome,
      },
    });
  });
}
