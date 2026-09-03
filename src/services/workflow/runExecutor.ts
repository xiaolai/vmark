/**
 * Workflow run executor (WI-NB6.1 / P-1) — the callback `runWebWorkflow` drives
 * each step through. It turns a parsed step into an act on the embedded browser,
 * re-deciding authorization on EVERY attempt so a one-shot spent on one step can
 * never carry to the next (the engine retries by calling this again).
 *
 * Executable steps:
 *   - `extract` — reader-mode read, no approval (read-class); the reader's
 *     `{title, textLength, truncated}` is kept as step data (W9).
 *   - `action` navigate/click/type (recorder grammar, `stepGrammar.ts`).
 *     `navigate to` is awaited on its ticket (`runNavigate.ts`, W2). A click or
 *     type runs through the standing-grant → one-shot → run-scoped-prompt path
 *     (`runApproval.ts`): a granted origin acts directly; an ungranted act raises
 *     a prompt bound to this run and waits — cancellably (W1) and with the run
 *     clock paused (W6). A role-less locator resolves its role from a fresh
 *     snapshot first, so the prompt names a real control (W10).
 *
 * Everything else — `goal`, `confirm`, `api`, and any `action` text the grammar
 * cannot execute — throws, which the engine converts to a pause (`needs-human`),
 * so the model reads `workflow_status`, acts manually, and may resume.
 *
 * Outcome mapping (→ `StepOutcome`): clicked/typed → success+met; obscured/hidden
 * → failed+false (retryable, heal-eligible); not-found → failed+false; disabled
 * or ambiguous → failed+undefined (stop-and-ask); a transport error propagates as
 * a throw (→ unknown → pause); a `WorkflowPause` carries its own code.
 *
 * @coordinates-with lib/browser/workflow/stepGrammar.ts — parses action text
 * @coordinates-with lib/browser/workflow/roleResolution.ts — role for a role-less locator
 * @coordinates-with lib/browser/workflow/selfHeal.ts — the heal proposal (P-3)
 * @coordinates-with lib/browser/workflow/runner.ts — calls this per step
 * @module services/workflow/runExecutor
 */

import { invoke } from "@tauri-apps/api/core";
import { buildClickScript, buildSnapshotScript, buildTypeScript } from "@/lib/browser/agent/actScript";
import { buildExtractHtmlScript } from "@/lib/browser/agent/extractScript";
import { readerForUrl } from "@/lib/sites/registry";
import { ensureBuiltinSitesRegistered } from "@/lib/sites/builtins";
import { WorkflowPause } from "@/lib/browser/workflow/engine";
import { proposeLocatorFix } from "@/lib/browser/workflow/selfHeal";
import { parseSnapshotResult, resolveRoleByName, type SnapshotRead } from "@/lib/browser/workflow/roleResolution";
import { parseAction, type ActionValue } from "@/lib/browser/workflow/stepGrammar";
import type { WorkflowStep } from "@/lib/browser/workflow/types";
import type { StepOutcome } from "@/lib/browser/workflow/safety";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { awaitAuthorization, throwIfAborted, type ApprovalRequest, type AuthorizedPage } from "./runApproval";
import { runNavigateStep, type NavigateStepContext } from "./runNavigate";
import type { RunClock } from "./runClock";
import type { PendingApprovalInfo } from "./runRegistry";

export interface RunExecutorContext {
  tabId: string;
  runId: string;
  /** Input variable values for `{name}` substitution (own properties only). */
  inputs: Record<string, string>;
  /** Current tab url + generation, re-read each attempt (the page may move). */
  resolveTab: () => { url: string; generation: number } | null;
  /** The run's running-time budget (D1v2). */
  clock: RunClock;
  /** Fired by cancel and human takeover; every wait exits on it. */
  signal: AbortSignal;
  /** The lease epoch the run acquired under. */
  leaseEpoch: number;
  /** Test seam: the wall clock (defaults to Date.now). */
  now?: () => number;
  /** Test seam: how long to sleep between approval polls (ms). */
  pollMs?: number;
  /** Set false to disable self-healing (default on). */
  selfHeal?: boolean;
  /** Mirror of the open prompt for `workflow_status`. */
  onPendingApproval?: (info: PendingApprovalInfo | null) => void;
  /** A `navigate to` step landed on a new page. */
  onNavigated?: (nav: { url: string; generation: number }) => void;
  /** Whether this run's ledger already holds the step's write — never heal it (W3). */
  isWriteLedgered?: (stepIndex: number) => boolean;
  /** Test seam: the navigation ticket wait (defaults to the broker). */
  waitForNavigation?: NavigateStepContext["waitForNavigation"];
}

type WorkflowStepExecutor = (step: WorkflowStep, index: number) => Promise<StepOutcome>;
type ActOp = "click" | "type";

const SUMMARY_MAX = 120;
const clip = (text: string): string => (text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text);

function resolveValue(value: ActionValue, inputs: Record<string, string>): string {
  if (value.kind === "literal") return value.text;
  // Own properties only: `inputs["constructor"]` would otherwise read Object's.
  if (!Object.hasOwn(inputs, value.name)) throw new Error(`workflow input "${value.name}" was not supplied`);
  return inputs[value.name];
}

/** Map an act script's result object onto a `StepOutcome`. */
function toOutcome(result: Record<string, unknown>, flag: "clicked" | "typed"): StepOutcome {
  if (result[flag] === true) return { outcome: "success", postconditionMet: true };
  const reason = typeof result.reason === "string" ? result.reason : result.found === false ? "not-found" : undefined;
  if (reason === "disabled" || reason === "ambiguous") return { outcome: "failed", reason }; // stop-and-ask
  return { outcome: "failed", postconditionMet: false, ...(reason !== undefined ? { reason } : {}) };
}

async function defaultWaitForNavigation(tabId: string, navigationId: string, timeoutMs: number) {
  await browserEventBroker.start();
  return browserEventBroker.wait(tabId, navigationId, timeoutMs);
}

export function makeRunExecutor(ctx: RunExecutorContext): WorkflowStepExecutor {
  const approvalCtx = {
    tabId: ctx.tabId,
    runId: ctx.runId,
    signal: ctx.signal,
    clock: ctx.clock,
    leaseEpoch: ctx.leaseEpoch,
    resolveTab: ctx.resolveTab,
    now: ctx.now ?? Date.now,
    pollMs: ctx.pollMs ?? 150,
    onPendingApproval: ctx.onPendingApproval ?? (() => {}),
  };
  const authorize = (req: ApprovalRequest): Promise<AuthorizedPage> => awaitAuthorization(approvalCtx, req);

  function currentTab(): { url: string; generation: number } {
    const tab = ctx.resolveTab();
    if (!tab) throw new Error("the browser tab is gone");
    return tab;
  }

  async function evalRead<T>(script: string, generation: number, parse: (raw: string) => T): Promise<T> {
    const raw = await invoke<string>("browser_eval", { tabId: ctx.tabId, script, operation: "read", generation });
    return parse(raw);
  }

  async function readSnapshot(generation: number): Promise<SnapshotRead> {
    const snapshot = await evalRead(buildSnapshotScript(generation), generation, parseSnapshotResult);
    if (snapshot === null) throw new Error("the page snapshot could not be read");
    return snapshot;
  }

  async function runExtract(): Promise<StepOutcome> {
    ensureBuiltinSitesRegistered();
    const tab = currentTab();
    const parsed = await evalRead(buildExtractHtmlScript(), tab.generation, (raw) => JSON.parse(raw) as { html?: unknown; truncated?: unknown });
    const reader = readerForUrl(tab.url);
    if (reader === null || typeof parsed.html !== "string") throw new Error("this page cannot be read");
    const result = reader.read(parsed.html, tab.url);
    return {
      outcome: "success",
      data: { title: result.title, textLength: result.textLength, truncated: parsed.truncated === true },
    };
  }

  /** Run one click/type against a role+name, authorizing per attempt (P-1). The act
   *  runs against the page the authorization was granted for. */
  async function actOnce(op: ActOp, role: string, name: string, text: string | undefined, url: string) {
    const script = op === "type" ? buildTypeScript(role, name, text ?? "") : buildClickScript(role, name);
    const page = await authorize({
      url,
      operation: op,
      target: { role, name },
      // A type binds the text it will enter by binding the built script (A-05).
      ...(op === "type" ? { script, payloadSummary: `Text: ${JSON.stringify(clip(text ?? ""))}` } : {}),
    });
    throwIfAborted(ctx.signal);
    const raw = await invoke<string>("browser_eval", {
      tabId: ctx.tabId,
      script,
      operation: op,
      generation: page.generation,
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
  async function healAndRetry(op: ActOp, role: string, name: string, text: string | undefined, url: string, generation: number): Promise<StepOutcome | null> {
    let snapshot: SnapshotRead;
    try {
      snapshot = await readSnapshot(generation);
    } catch {
      return null;
    }
    const fix = proposeLocatorFix({ role, name }, snapshot.nodes);
    if (fix === null || fix.name === name) return null;
    const { raw: _raw, ...healed } = await actOnce(op, fix.role, fix.name, text, url);
    return { ...healed, data: { healedFrom: name, healedTo: fix.name } };
  }

  /** W10 — a role-less locator: resolve the role from a fresh snapshot, or explain. */
  async function resolveRole(name: string, generation: number): Promise<string | StepOutcome> {
    const resolution = resolveRoleByName(await readSnapshot(generation), name);
    switch (resolution.kind) {
      case "resolved":
        return resolution.role;
      case "none":
        return { outcome: "failed", postconditionMet: false, reason: "not-found" };
      case "ambiguous":
        return { outcome: "failed", reason: `ambiguous: "${name}" is a ${resolution.roles.join(", ")}` };
      default:
        return { outcome: "failed", reason: resolution.reason };
    }
  }

  async function runAction(step: WorkflowStep): Promise<StepOutcome> {
    const parsed = parseAction(step.text);
    if (!parsed.ok) {
      if (parsed.code === "not-executable") throw new Error(`step is not executable: "${step.text}" — hand it to the model`);
      throw new Error(`${parsed.code}: ${parsed.detail} — in "${step.text}"`);
    }
    const action = parsed.action;
    const tab = currentTab();
    if (action.kind === "navigate") {
      return runNavigateStep(
        {
          tabId: ctx.tabId,
          signal: ctx.signal,
          clock: ctx.clock,
          authorize,
          waitForNavigation: ctx.waitForNavigation ?? defaultWaitForNavigation,
          ...(ctx.onNavigated ? { onNavigated: ctx.onNavigated } : {}),
        },
        action.url,
      );
    }
    const value = action.kind === "type" ? resolveValue(action.value, ctx.inputs) : undefined;
    let role = action.role;
    if (role === undefined) {
      const resolved = await resolveRole(action.name, tab.generation);
      if (typeof resolved !== "string") return resolved;
      role = resolved;
    }
    const { raw, ...first } = await actOnce(action.kind, role, action.name, value, tab.url);
    // A not-found act is the healable case: the locator drifted. An obscured or
    // disabled target is a page-state problem heal cannot fix — and a step whose
    // write is already ledgered is looking at the POST-action page (W3).
    const ledgered = ctx.isWriteLedgered?.(step.index) ?? false;
    if (raw.found === false && ctx.selfHeal !== false && !ledgered) {
      const healed = await healAndRetry(action.kind, role, action.name, value, tab.url, tab.generation);
      if (healed !== null) return healed;
    }
    return first;
  }

  return async (step) => {
    throwIfAborted(ctx.signal);
    if (ctx.clock.expired()) throw new WorkflowPause("deadline", "the run's running-time budget is spent");
    if (step.kind === "extract") return runExtract();
    if (step.kind === "action") return runAction(step);
    // goal / confirm / api — a human/model gate, never machine-run.
    throw new Error(`step kind '${step.kind}' needs the model: ${step.text}`);
  };
}
