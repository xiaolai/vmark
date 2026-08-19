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
 * @coordinates-with services/workflow/workflowRunService.ts — the orchestrator
 * @module services/mcpBridge/v2/browserWorkflow
 */

import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { browserEnabled, readTabIdArg, resolveBrowserTab } from "./browserHelpers";
import { urlForAgent } from "@/lib/browser/url";
import {
  startWorkflowRun,
  workflowRunStatus,
  cancelWorkflowRun,
} from "@/services/workflow/workflowRunService";

function readInputs(raw: unknown): Record<string, string> | null {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}

/** `vmark.browser.workflow_run` — start a run; returns {runId, steps}. */
export async function handleBrowserWorkflowRun(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!browserEnabled()) {
      await respond({ id, success: false, error: "BROWSER_DISABLED" });
      return;
    }
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
    const result = startWorkflowRun(args.source, {
      tabId: tab.tabId,
      resolveTab: () => {
        const t = resolveBrowserTab(tab.tabId);
        return t ? { url: t.url, generation: t.generation } : null;
      },
      inputs,
      ...(args.allowRepeat === true ? { allowRepeat: true } : {}),
    });
    if (!result.ok) {
      await respond({ id, success: false, error: result.error });
      return;
    }
    await respond({ id, success: true, data: { runId: result.runId, steps: result.steps, status: "running" } });
  });
}

/** `vmark.browser.workflow_status` — the current state of a run. */
export async function handleBrowserWorkflowStatus(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!browserEnabled()) {
      await respond({ id, success: false, error: "BROWSER_DISABLED" });
      return;
    }
    if (typeof args.runId !== "string" || args.runId === "") {
      await respond({ id, success: false, error: "workflow_status requires a `runId`" });
      return;
    }
    const state = workflowRunStatus(args.runId);
    if (state === null) {
      await respond({ id, success: false, error: "unknown runId" });
      return;
    }
    await respond({
      id,
      success: true,
      data: {
        runId: state.runId,
        status: state.status,
        completedSteps: state.completedSteps,
        stepCount: state.stepCount,
        ...(state.pausedAt !== undefined ? { pausedAt: state.pausedAt } : {}),
        ...(state.reasonCode !== undefined ? { reasonCode: state.reasonCode } : {}),
        ...(state.reason !== undefined ? { reason: state.reason } : {}),
        stepResults: state.stepResults,
        url: urlForAgent(resolveBrowserTab(state.tabId)?.url ?? ""),
      },
    });
  });
}

/** `vmark.browser.workflow_cancel` — stop a run (never approval-gated). */
export async function handleBrowserWorkflowCancel(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!browserEnabled()) {
      await respond({ id, success: false, error: "BROWSER_DISABLED" });
      return;
    }
    if (typeof args.runId !== "string" || args.runId === "") {
      await respond({ id, success: false, error: "workflow_cancel requires a `runId`" });
      return;
    }
    cancelWorkflowRun(args.runId);
    await respond({ id, success: true, data: { runId: args.runId, status: "cancelled" } });
  });
}
