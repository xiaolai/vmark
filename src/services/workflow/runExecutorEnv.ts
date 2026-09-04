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
/** The CLOSED shape an act script returns (`agentAct.ts`): every key it can emit,
 *  with its type. Anything else in the result is page-adjacent garbage. */
const ACT_RESULT_SCHEMA: Record<string, (v: unknown) => boolean> = {
  found: (v) => typeof v === "boolean",
  clicked: (v) => typeof v === "boolean",
  typed: (v) => typeof v === "boolean",
  reason: (v) => typeof v === "string",
  detail: (v) => typeof v === "string",
  by: (v) => typeof v === "string",
  matchedTotal: (v) => Number.isInteger(v) && (v as number) >= 0,
  matchedVisible: (v) => Number.isInteger(v) && (v as number) >= 0,
  candidates: (v) =>
    Array.isArray(v) &&
    v.every((c) => typeof c === "object" && c !== null && typeof (c as { ref?: unknown }).ref === "string" && typeof (c as { text?: unknown }).text === "string"),
};

/** Validate the whole result against the schema: `found` and the operation's flag
 *  are required, every other key optional but typed, unknown keys refused. */
function actResultIsWellFormed(result: Record<string, unknown>, flag: "clicked" | "typed"): boolean {
  if (typeof result.found !== "boolean" || typeof result[flag] !== "boolean") return false;
  // A miss always reports how many candidates it matched and how many were visible
  // (the act script emits both on every `found:false`); a count-less miss is not the
  // script's verdict and must not become a healable not-found (round 5, #193).
  if (result.found === false && (result.matchedTotal === undefined || result.matchedVisible === undefined)) return false;
  for (const key of Object.keys(result)) {
    // Own-property lookup (round 12): a page-shaped key such as "constructor" would
    // otherwise resolve through Object.prototype to a function that accepts anything.
    if (!Object.hasOwn(ACT_RESULT_SCHEMA, key) || !ACT_RESULT_SCHEMA[key](result[key])) return false;
  }
  const other = flag === "clicked" ? "typed" : "clicked";
  return result[other] === undefined;
}

/** Does the result fit one of the producer's THREE shapes (round 7, #193)?
 *  A miss is `found:false`, the verb false, counts 0/0 and nothing else; a refusal
 *  is `found:true`, the verb false and a KNOWN reason (candidates only with
 *  `ambiguous`, `by` only with `obscured`); a success carries no reason, `by` or
 *  candidates. Field-by-field typing let impossible combinations through one at a
 *  time — `{found:true, clicked:false, reason:"not-found"}` was the latest — so the
 *  shapes are checked as a closed set. */
function actResultFitsProducerShape(result: Record<string, unknown>, flag: "clicked" | "typed"): boolean {
  const hasAny = (...keys: string[]) => keys.some((k) => result[k] !== undefined);
  // Every result carries its counts (the ref path included, round 8): how many
  // elements the locator matched and how many of them were visible.
  const total = result.matchedTotal;
  const visible = result.matchedVisible;
  if (typeof total !== "number" || typeof visible !== "number" || visible > total) return false;
  if (result.found === false) {
    return result[flag] === false && total === 0 && visible === 0 && !hasAny("reason", "detail", "by", "candidates");
  }
  if (total < 1) return false; // found:true names at least one match
  // The producer acts only on EXACTLY one visible match: two are `ambiguous`, none is
  // `hidden` (or `disabled` for an inert set). So a success is visible === 1, and
  // each refusal fixes its own count (round 9).
  if (result[flag] === true) {
    // Only a contenteditable whose editor took the insertion annotates a success.
    const detailOk = result.detail === undefined || (flag === "typed" && result.detail === "editor-handled");
    return visible === 1 && detailOk && !hasAny("reason", "by", "candidates");
  }
  if (typeof result.reason !== "string" || !Object.hasOwn(ACT_REFUSAL_VISIBLE, result.reason)) return false;
  if (!ACT_REFUSAL_VISIBLE[result.reason](visible)) return false;
  // Reasons are per operation (round 13): a click never reports a typing refusal.
  if (flag === "clicked" && TYPED_ONLY_REASONS.has(result.reason)) return false;
  // `detail` is fixed per reason (round 10): `inert` on disabled, `editor-cancelled`
  // on rejected-value, nothing anywhere else; `by` names the occluder and only it.
  // `error` (a typing exception) carries the message as free-text detail; every
  // other reason's detail is fixed.
  if (result.reason === "error") {
    if (typeof result.detail !== "string") return false;
  } else {
    const detailAllowed = Object.hasOwn(ACT_REFUSAL_DETAIL, result.reason) ? ACT_REFUSAL_DETAIL[result.reason] : undefined;
    if (result.detail !== undefined && result.detail !== detailAllowed) return false;
  }
  // An ambiguity names its candidates — one per visible match — and nothing else does.
  if (result.reason === "ambiguous") {
    if (!Array.isArray(result.candidates) || result.candidates.length !== visible) return false;
  } else if (result.candidates !== undefined) {
    return false;
  }
  return result.reason === "obscured" ? typeof result.by === "string" : result.by === undefined;
}

/** The one `detail` a refusal may carry, per the producer; absent = none. */
const ACT_REFUSAL_DETAIL: Record<string, string | undefined> = {
  disabled: "inert",
  "rejected-value": "editor-cancelled",
};

/** How many VISIBLE matches each refusal reports, per the producer's construction
 *  (`agentAct.ts`): `hidden` and inert-`disabled` come from a set with no visible
 *  match; `ambiguous` from two or more; every other refusal is judged on the ONE
 *  visible match that was picked. */
const ACT_REFUSAL_VISIBLE: Record<string, (visible: number) => boolean> = {
  hidden: (v) => v === 0,
  ambiguous: (v) => v >= 2,
  disabled: (v) => v === 0 || v === 1,
  upload: (v) => v === 1,
  offscreen: (v) => v === 1,
  obscured: (v) => v === 1,
  readonly: (v) => v === 1,
  "not-editable": (v) => v === 1,
  "no-such-option": (v) => v === 1,
  "rejected-value": (v) => v === 1,
  error: (v) => v === 1,
};

/** Refusals only `__vmarkDoType`/`__vmarkTypeField`/`__vmarkTypeSelect` produce. */
const TYPED_ONLY_REASONS: ReadonlySet<string> = new Set(["readonly", "not-editable", "no-such-option", "rejected-value", "error"]);

/** Map an act script's result object onto a `StepOutcome`. */
function toOutcome(result: Record<string, unknown>, flag: "clicked" | "typed"): StepOutcome {
  // The act script's result is page-adjacent data and is validated against its
  // COMPLETE schema, not trusted (round 4, #193): a key the script never emits, a
  // wrong type, or the other operation's flag is malformed; a success that also
  // carries a failure (a reason, an occluder, candidates, found:false) or counts
  // that disagree is contradictory. Both are UNKNOWN — the engine asks a human
  // rather than treating them as success or as a confirmed miss eligible for a
  // write retry.
  if (typeof result !== "object" || result === null || !actResultIsWellFormed(result, flag)) {
    return { outcome: "unknown", reason: "malformed-act-result" };
  }
  const succeeded = result[flag] === true;
  const total = result.matchedTotal as number | undefined;
  const visible = result.matchedVisible as number | undefined;
  if (total !== undefined && visible !== undefined && visible > total) return { outcome: "unknown", reason: "contradictory-act-result" };
  // The producer reports `found:false` only when NOTHING matched (counts 0/0); a
  // hidden, disabled or ambiguous match is `found:true` with a reason. A miss that
  // reports matches is therefore not the script's verdict (round 6, #193).
  if (result.found === false && ((total ?? 0) > 0 || (visible ?? 0) > 0)) return { outcome: "unknown", reason: "contradictory-act-result" };
  if (succeeded && (result.found === false || result.reason !== undefined || result.by !== undefined || result.candidates !== undefined)) {
    return { outcome: "unknown", reason: "contradictory-act-result" };
  }
  if (!actResultFitsProducerShape(result, flag)) return { outcome: "unknown", reason: "malformed-act-result" };
  if (succeeded) return { outcome: "success", postconditionMet: true };
  const reason = typeof result.reason === "string" ? result.reason : result.found === false ? "not-found" : undefined;
  // A typing exception may have landed AFTER the field was touched (round 14): its
  // postcondition is unknown, not "not applied", so it is never retried by itself.
  if (reason === "error") return { outcome: "unknown", reason: "act-threw" };
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
