/**
 * runExecutorEnv — the executor's shared environment (round 3, #106): the
 * authorization adapter, tab resolution, read-class evals, the snapshot read and
 * the single authorized act. `runExecutor.ts` composes steps from these;
 * `runExecutorHeal.ts` heals with them. Pure functions first (outcome mapping,
 * input substitution), then the factory.
 *
 * @coordinates-with services/workflow/runExecutor.ts — composes the steps
 * @coordinates-with services/workflow/runExecutorHeal.ts — heals through the env
 * @coordinates-with services/workflow/runApproval.ts — awaitAuthorization
 * @module services/workflow/runExecutorEnv
 */
import { invoke } from "@tauri-apps/api/core";
import { buildClickScript, buildSnapshotScript, buildTypeScript } from "@/lib/browser/agent/actScript";
import { parseSnapshotResult, type SnapshotRead } from "@/lib/browser/workflow/roleResolution";
import type { ActionValue } from "@/lib/browser/workflow/stepGrammar";
import type { StepOutcome } from "@/lib/browser/workflow/safety";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { awaitAuthorization, throwIfAborted, type ApprovalRequest, type AuthorizedPage } from "./runApproval";
import type { NavigateStepContext } from "./runNavigate";
import type { RunClock } from "./runClock";
import type { PendingApprovalInfo } from "./runRegistry";

export type ActOp = "click" | "type";

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

const SUMMARY_MAX = 120;
const clip = (text: string): string => {
  const points = Array.from(text); // never split a surrogate pair
  return points.length > SUMMARY_MAX ? `${points.slice(0, SUMMARY_MAX).join("")}…` : text;
};

export function resolveValue(value: ActionValue, inputs: Record<string, string>): string {
  if (value.kind === "literal") return value.text;
  // Own properties only: `inputs["constructor"]` would otherwise read Object's.
  if (!Object.hasOwn(inputs, value.name)) throw new Error(`workflow input "${value.name}" was not supplied`);
  return inputs[value.name];
}

/** Map an act script's result object onto a `StepOutcome`. */
function toOutcome(result: Record<string, unknown>, flag: "clicked" | "typed"): StepOutcome {
  // The act script's result is page-adjacent data and is validated, not trusted: the
  // flag must be a boolean, and `found:false` with the flag true is a contradiction.
  // Anything malformed or contradictory is UNKNOWN — the engine asks a human rather
  // than treating it as success or as a confirmed miss eligible for a write retry.
  if (typeof result !== "object" || result === null || typeof result[flag] !== "boolean" || typeof result.found !== "boolean") {
    return { outcome: "unknown", reason: "malformed-act-result" };
  }
  if (result[flag] === true && result.found === false) return { outcome: "unknown", reason: "contradictory-act-result" };
  // A reason, when present, is a string — `{found:true, clicked:false, reason:42}` is
  // page-adjacent garbage, not a confirmed failure the engine may retry a write on.
  if (result.reason !== undefined && typeof result.reason !== "string") return { outcome: "unknown", reason: "malformed-act-result" };
  if (result[flag] === true) return { outcome: "success", postconditionMet: true };
  const reason = typeof result.reason === "string" ? result.reason : result.found === false ? "not-found" : undefined;
  if (reason === "disabled" || reason === "ambiguous") return { outcome: "failed", reason }; // stop-and-ask
  return { outcome: "failed", postconditionMet: false, ...(reason !== undefined ? { reason } : {}) };
}

export async function defaultWaitForNavigation(tabId: string, navigationId: string, timeoutMs: number) {
  await browserEventBroker.start();
  return browserEventBroker.wait(tabId, navigationId, timeoutMs);
}

/** What every step shares: authorization, the live tab, evals, the snapshot, one act. */
export interface ExecutorEnv {
  ctx: RunExecutorContext;
  authorize: (req: ApprovalRequest) => Promise<AuthorizedPage>;
  currentTab: () => { url: string; generation: number };
  evalRead: <T>(script: string, generation: number, parse: (raw: string) => T) => Promise<T>;
  readSnapshot: (generation: number) => Promise<SnapshotRead>;
  /** One click/type against a role+name, authorizing per attempt (P-1); `healed`
   *  asks for fresh approval (#162). */
  actOnce: (op: ActOp, role: string, name: string, text: string | undefined, url: string, healed?: boolean) => Promise<StepOutcome & { raw: Record<string, unknown> }>;
}

export function makeExecutorEnv(ctx: RunExecutorContext): ExecutorEnv {
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
  /** Run one click/type against a role+name, authorizing per attempt (P-1). The act
   *  runs against the page the authorization was granted for. */
  async function actOnce(op: ActOp, role: string, name: string, text: string | undefined, url: string, healed = false) {
    const script = op === "type" ? buildTypeScript(role, name, text ?? "") : buildClickScript(role, name);
    const page = await authorize({
      url,
      operation: op,
      target: { role, name },
      // A healed locator is not the one the author wrote: a standing grant does
      // not cover it — the human sees the new target and approves it (#162).
      ...(healed ? { requireFreshApproval: true } : {}),
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
    // Page-adjacent data: anything that is not an object becomes an empty record,
    // which `toOutcome` reports as malformed — nothing downstream reads a null.
    const decoded: unknown = JSON.parse(raw);
    const parsed = typeof decoded === "object" && decoded !== null ? (decoded as Record<string, unknown>) : {};
    return { ...toOutcome(parsed, op === "type" ? "typed" : "clicked"), raw: parsed };
  }

  return { ctx, authorize, currentTab, evalRead, readSnapshot, actOnce };
}
