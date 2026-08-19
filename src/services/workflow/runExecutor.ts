/**
 * Workflow run executor (WI-NB6.1 / P-1) — the callback `runWebWorkflow` drives
 * each step through. It turns a parsed step into an act on the embedded browser,
 * re-deciding authorization on EVERY attempt so a one-shot spent on one step can
 * never carry to the next (the engine retries by calling this again).
 *
 * Executable steps:
 *   - `extract` — reader-mode read, no approval (read-class), always success.
 *   - `action` navigate/click/type (recorder grammar, `stepGrammar.ts`) — run
 *     through the standing-grant → one-shot → run-scoped-prompt path. A granted
 *     origin acts directly; an ungranted act raises a prompt bound to this run
 *     and awaits authorization until the run deadline, then throws (pause).
 *
 * Everything else — `goal`, `confirm`, `api`, and any `action` text the grammar
 * cannot execute — throws, which the engine converts to a pause (`needs-human`),
 * so the model reads `workflow_status`, acts manually, and may resume.
 *
 * Outcome mapping (→ `StepOutcome`): clicked/typed → success+met; obscured/hidden
 * → failed+false (retryable, heal-eligible); not-found → failed+false; disabled
 * → failed+undefined (stop-and-ask); a transport error propagates as a throw
 * (→ unknown → pause).
 *
 * @coordinates-with lib/browser/workflow/stepGrammar.ts — parses action text
 * @coordinates-with lib/browser/workflow/runner.ts — calls this per step
 * @coordinates-with stores/browserApprovalStore.ts — the authorization gate
 * @module services/workflow/runExecutor
 */

import { invoke } from "@tauri-apps/api/core";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { mintOneShotConfirmed } from "@/services/browser/grantSync";
import { buildClickScript, buildTypeScript } from "@/lib/browser/agent/actScript";
import { buildExtractHtmlScript } from "@/lib/browser/agent/extractScript";
import { readerForUrl } from "@/lib/sites/registry";
import { ensureBuiltinSitesRegistered } from "@/lib/sites/builtins";
import { originForAgent } from "@/lib/browser/url";
import { buildSnapshotScript } from "@/lib/browser/agent/actScript";
import { proposeLocatorFix } from "@/lib/browser/workflow/selfHeal";
import { parseActionText, type ActionValue } from "@/lib/browser/workflow/stepGrammar";
import type { WorkflowStep } from "@/lib/browser/workflow/types";
import type { StepOutcome } from "@/lib/browser/workflow/safety";
import type { AriaNode } from "@/lib/browser/agent/aria";

export interface RunExecutorContext {
  tabId: string;
  runId: string;
  /** Input variable values for `{name}` substitution. */
  inputs: Record<string, string>;
  /** Current tab url + generation, re-read each attempt (the page may move). */
  resolveTab: () => { url: string; generation: number } | null;
  /** Epoch ms after which an unresolved approval pauses the run. */
  deadlineAt: number;
  /** Test seam: the wall clock (defaults to Date.now). */
  now?: () => number;
  /** Test seam: how long to sleep between approval polls (ms). */
  pollMs?: number;
  /** Set false to disable self-healing (default on). */
  selfHeal?: boolean;
}

type WorkflowStepExecutor = (step: WorkflowStep, index: number) => Promise<StepOutcome>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function resolveValue(value: ActionValue, inputs: Record<string, string>): string {
  if (value.kind === "literal") return value.text;
  const v = inputs[value.name];
  if (v === undefined) throw new Error(`workflow input "${value.name}" was not supplied`);
  return v;
}

/** Build a StepOutcome, omitting `postconditionMet` when it is undefined
 *  (exactOptionalPropertyTypes). `undefined` = stop-and-ask. */
function stepOutcome(outcome: StepOutcome["outcome"], met?: boolean): StepOutcome {
  return met === undefined ? { outcome } : { outcome, postconditionMet: met };
}

/** Map an act script's result object onto a `StepOutcome`. */
function toOutcome(result: unknown, flag: "clicked" | "typed"): StepOutcome {
  if (typeof result !== "object" || result === null) return stepOutcome("failed", false);
  const r = result as { [k: string]: unknown; reason?: string };
  if (r[flag] === true) return stepOutcome("success", true);
  if (r.reason === "disabled") return stepOutcome("failed"); // undefined → stop-and-ask
  return stepOutcome("failed", false);
}

export function makeRunExecutor(ctx: RunExecutorContext): WorkflowStepExecutor {
  const now = ctx.now ?? Date.now;
  const pollMs = ctx.pollMs ?? 150;

  /** Ensure the act is authorized; returns when it is, throws (pause) at the
   *  deadline. Re-decided every call — P-1. */
  async function authorize(url: string, operation: string, target: { role: string; name: string }): Promise<void> {
    const store = useBrowserApprovalStore.getState;
    const decision = store().decide(url, operation);
    if (decision === "denied") throw new Error(`operation '${operation}' is not permitted on ${originForAgent(url)}`);
    if (decision === "allowed") return; // a standing grant — the driver already has it

    // needs-approval: spend a matching one-shot, or raise a run-scoped prompt.
    const tab = ctx.resolveTab();
    const generation = tab?.generation ?? 0;
    if (store().consumeOneShot(url, operation, target, ctx.tabId)) {
      const ok = await mintOneShotConfirmed({ originPattern: originForAgent(url), operation, tabId: ctx.tabId, generation, target });
      if (!ok) throw new Error(`the driver refused the '${operation}' authorization`);
      return;
    }
    // Raise a prompt bound to this run, then poll until it is authorized.
    const reqId = `${ctx.runId}:${operation}:${target.role}:${target.name}:${now()}`;
    store().requestApproval(reqId, url, operation, target, ctx.tabId, generation, undefined, ctx.runId);
    for (;;) {
      if (now() >= ctx.deadlineAt) {
        throw new Error(`approval required for '${operation}' on ${originForAgent(url)} — the run is waiting`);
      }
      if (store().decide(url, operation) === "allowed") return;
      if (store().consumeOneShot(url, operation, target, ctx.tabId)) {
        const ok = await mintOneShotConfirmed({ originPattern: originForAgent(url), operation, tabId: ctx.tabId, generation, target });
        if (!ok) throw new Error(`the driver refused the '${operation}' authorization`);
        return;
      }
      await sleep(pollMs);
    }
  }

  async function runExtract(): Promise<StepOutcome> {
    ensureBuiltinSitesRegistered();
    const tab = ctx.resolveTab();
    if (!tab) throw new Error("the browser tab is gone");
    const raw = await invoke<string>("browser_eval", {
      tabId: ctx.tabId,
      script: buildExtractHtmlScript(),
      operation: "read",
      generation: tab.generation,
    });
    const parsed = JSON.parse(raw) as { html?: unknown };
    const reader = readerForUrl(tab.url);
    if (reader === null || typeof parsed.html !== "string") throw new Error("this page cannot be read");
    reader.read(parsed.html, tab.url);
    return { outcome: "success" };
  }

  /** Run one click/type against a role+name, authorizing per attempt (P-1). */
  async function actOnce(
    op: "click" | "type",
    role: string,
    name: string,
    text: string | undefined,
    url: string,
    generation: number,
  ): Promise<StepOutcome & { raw: Record<string, unknown> }> {
    const script = op === "type" ? buildTypeScript(role || "textbox", name, text ?? "") : buildClickScript(role, name);
    await authorize(url, op, { role, name });
    const raw = await invoke<string>("browser_eval", {
      tabId: ctx.tabId,
      script,
      operation: op,
      generation,
      role,
      name,
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { ...toOutcome(parsed, op === "type" ? "typed" : "clicked"), raw: parsed };
  }

  /** WI-NB6.4 — one heal attempt: read a fresh snapshot, propose a same-role
   *  locator whose name is close to the failed one, and retry the act against
   *  it. The healed act re-enters `authorize` (P-3): a one-shot bound to the old
   *  descriptor cannot match the new name, so a standing grant is required or a
   *  fresh prompt is raised. */
  async function healAndRetry(
    op: "click" | "type",
    role: string,
    name: string,
    text: string | undefined,
    url: string,
    generation: number,
  ): Promise<StepOutcome | null> {
    let snapshot: AriaNode[];
    try {
      const raw = await invoke<string>("browser_eval", {
        tabId: ctx.tabId,
        script: buildSnapshotScript(generation),
        operation: "read",
        generation,
      });
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      snapshot = parsed as AriaNode[];
    } catch {
      return null;
    }
    const fix = proposeLocatorFix({ role, name }, snapshot);
    if (fix === null || fix.name === name) return null;
    const healed = await actOnce(op, fix.role, fix.name, text, url, generation);
    return stepOutcome(healed.outcome, healed.postconditionMet);
  }

  async function runAction(text: string): Promise<StepOutcome> {
    const action = parseActionText(text);
    if (action === null) throw new Error(`step is not executable: "${text}" — hand it to the model`);
    const tab = ctx.resolveTab();
    if (!tab) throw new Error("the browser tab is gone");

    if (action.kind === "navigate") {
      await authorize(tab.url, "navigate", { role: "", name: action.url });
      const res = await invoke<{ navigationId?: unknown }>("browser_ai_navigate", { tabId: ctx.tabId, url: action.url });
      return { outcome: res && typeof res === "object" ? "success" : "failed", postconditionMet: true };
    }

    const role = action.role ?? "";
    const value = action.kind === "type" ? resolveValue(action.value, ctx.inputs) : undefined;
    const first = await actOnce(action.kind, role, action.name, value, tab.url, tab.generation);
    // A not-found act is the healable case: the locator drifted. An obscured or
    // disabled target is a page-state problem heal cannot fix.
    if (first.raw.found === false && ctx.selfHeal !== false) {
      const healed = await healAndRetry(action.kind, role, action.name, value, tab.url, tab.generation);
      if (healed !== null) return healed;
    }
    return stepOutcome(first.outcome, first.postconditionMet);
  }

  return async (step) => {
    if (step.kind === "extract") return runExtract();
    if (step.kind === "action") return runAction(step.text);
    // goal / confirm / api — a human/model gate, never machine-run.
    throw new Error(`step kind '${step.kind}' needs the model: ${step.text}`);
  };
}
