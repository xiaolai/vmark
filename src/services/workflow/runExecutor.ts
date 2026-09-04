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
 * Split (round 3, #106): `runExecutorEnv.ts` holds the shared environment
 * (authorize, tab, evals, snapshot, the single authorized act) and the pure
 * outcome/input helpers; `runExecutorHeal.ts` holds role resolution and the heal
 * retry. This file composes the two step kinds from them.
 *
 * @coordinates-with lib/browser/workflow/stepGrammar.ts — parses action text
 * @coordinates-with services/workflow/runExecutorEnv.ts — the shared environment
 * @coordinates-with services/workflow/runExecutorHeal.ts — role resolution + heal
 * @coordinates-with lib/browser/workflow/runner.ts — calls this per step
 * @module services/workflow/runExecutor
 */

import { buildExtractHtmlScript } from "@/lib/browser/agent/extractScript";
import { readerForUrl } from "@/lib/sites/registry";
import { ensureBuiltinSitesRegistered } from "@/lib/sites/builtins";
import { WorkflowPause } from "@/lib/browser/workflow/engine";
import { parseAction } from "@/lib/browser/workflow/stepGrammar";
import type { WorkflowStep } from "@/lib/browser/workflow/types";
import type { StepOutcome } from "@/lib/browser/workflow/safety";
import { throwIfAborted } from "./runApproval";
import { runNavigateStep } from "./runNavigate";
import { defaultWaitForNavigation, makeExecutorEnv, resolveValue } from "./runExecutorEnv";
import { healAndRetry, resolveRole } from "./runExecutorHeal";

import type { RunExecutorContext } from "./runExecutorEnv";
export type { RunExecutorContext } from "./runExecutorEnv";

type WorkflowStepExecutor = (step: WorkflowStep, index: number) => Promise<StepOutcome>;

export function makeRunExecutor(ctx: RunExecutorContext): WorkflowStepExecutor {
  const env = makeExecutorEnv(ctx);
  const { currentTab, evalRead, authorize, actOnce } = env;

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
      const resolved = await resolveRole(env, action.name, tab.generation);
      if (typeof resolved !== "string") return resolved;
      role = resolved;
    }
    const { raw: _raw, ...first } = await actOnce(action.kind, role, action.name, value, tab.url);
    // A not-found act is the healable case: the locator drifted. An obscured or
    // disabled target is a page-state problem heal cannot fix — and a step whose
    // write is already ledgered is looking at the POST-action page (W3).
    const ledgered = ctx.isWriteLedgered?.(step.index) ?? false;
    // Heal on the VALIDATED outcome — a confirmed not-found — never on the raw
    // flag: `{found:false, clicked:true}` is contradictory (unknown), and healing
    // it would be a second write on the strength of page-adjacent garbage.
    const notFound = first.outcome === "failed" && first.reason === "not-found";
    if (notFound && ctx.selfHeal !== false && !ledgered) {
      const healed = await healAndRetry(env, action.kind, role, action.name, value, tab.url, tab.generation);
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
