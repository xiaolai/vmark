/**
 * MCP v2 `vmark.browser.act` handler (WI-2.5 / WI-P2.2 / WI-P4.2).
 *
 * Extracted from browser.ts (audit #9) so the act path — the most complex MCP
 * handler — lives in its own file. `act` performs `click` / `type` / `scroll` /
 * `key`, targeting either a precise `{ref}` (from a prior read; honored only on
 * the already-granted path) or ARIA `{role, name}` (through the approval flow).
 *
 * Shape (round 3, #38): the shared envelope resolves the tab
 * (`resolveBrowserTarget`), `parseActAction` turns the payload into one validated
 * action, the attachment gate runs, and the action is dispatched to one small
 * function per operation — each builds its script and hands it to the approval
 * flow (`browserActFlow`). Validation runs BEFORE the attachment gate, the power
 * tools' ordering rule: a malformed act fails on its own and never queues an
 * attach prompt for the user to answer.
 *
 * **The check here is advisory.** The authoritative gate is the Rust driver
 * (browser/authorize.rs): it re-checks the operation against the tab's committed
 * origin and rejects a stale generation. `scroll`/`key` dispatch SYNTHETIC DOM
 * events (SPIKE-3), so a site gating on `event.isTrusted` ignores them.
 *
 * Audit 2026-09-03: a `type`, `key` or `scroll` approval binds the BUILT script
 * (so the text, key+modifiers or delta the user approved is what runs — A-05)
 * and the prompt shows a one-line summary of it; the one-shot mint is awaited
 * before acting (single mint path, A-04); a driver rejection propagates to
 * `wrapHandler` as its typed token instead of "did not affect the target"
 * (E-01/E-03); a popup the page tried to open during the act is reported (X-03);
 * the attachment mirror follows the driver's consume (A-01).
 *
 * @coordinates-with src-tauri browser/authorize.rs — the authoritative gate
 * @coordinates-with lib/browser/agent/actScript.ts / interactScript.ts — the scripts
 * @coordinates-with services/mcpBridge/v2/browserActParse.ts — payload → validated action
 * @coordinates-with services/mcpBridge/v2/browserActFlow.ts — approval + one-shot flow
 * @module services/mcpBridge/v2/browserAct
 */

import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import {
  buildClickScript,
  buildClickByRefScript,
  buildTypeScript,
  buildTypeByRefScript,
} from "@/lib/browser/agent/actScript";
import {
  buildScrollToRefScript,
  buildScrollByScript,
  buildKeyScript,
  type KeyModifiers,
} from "@/lib/browser/agent/interactScript";
import type { BrowserTarget } from "./browserHelpers";
import { resolveBrowserTarget } from "./browserAccess";
import { requireHumanAttachment } from "./browserReadClass";
import { approveAndAct, finishAct, refuseUngrantedRef } from "./browserActFlow";
import { parseActAction, type ActAction } from "./browserActParse";

/** Clip a payload for the prompt's one-line summary. */
const SUMMARY_MAX = 120;
function clip(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

function describeKey(key: string, modifiers: KeyModifiers | undefined): string {
  const parts: string[] = [];
  if (modifiers?.ctrl) parts.push("Ctrl");
  if (modifiers?.alt) parts.push("Alt");
  if (modifiers?.shift) parts.push("Shift");
  if (modifiers?.meta) parts.push("Meta");
  parts.push(key);
  return `Key: ${parts.join("+")}`;
}

type ActionOf<K extends ActAction["operation"]> = Extract<ActAction, { operation: K }>;

async function actClick(id: string, tab: BrowserTarget, action: ActionOf<"click">): Promise<void> {
  if (action.targeting.by === "ref") {
    if (await refuseUngrantedRef(id, tab, "click")) return;
    await finishAct(id, tab, "click", buildClickByRefScript(action.targeting.ref, tab.generation));
    return;
  }
  const { role, name } = action.targeting;
  await approveAndAct(id, tab, "click", { role, name }, buildClickScript(role, name, tab.generation));
}

async function actType(id: string, tab: BrowserTarget, action: ActionOf<"type">): Promise<void> {
  if (action.targeting.by === "ref") {
    if (await refuseUngrantedRef(id, tab, "type")) return;
    await finishAct(id, tab, "type", buildTypeByRefScript(action.targeting.ref, action.text, tab.generation));
    return;
  }
  const { role, name } = action.targeting;
  // The built script embeds the text, so binding the script binds the text.
  const script = buildTypeScript(role, name, action.text, tab.generation);
  await approveAndAct(id, tab, "type", { role, name }, script, `Text: ${JSON.stringify(clip(action.text))}`);
}

async function actScroll(id: string, tab: BrowserTarget, action: ActionOf<"scroll">): Promise<void> {
  if (action.targeting.by === "ref") {
    if (await refuseUngrantedRef(id, tab, "scroll")) return;
    await finishAct(id, tab, "scroll", buildScrollToRefScript(action.targeting.ref, tab.generation));
    return;
  }
  const { dy } = action.targeting;
  await approveAndAct(id, tab, "scroll", undefined, buildScrollByScript(dy), `Scroll by ${dy} px`);
}

async function actKey(id: string, tab: BrowserTarget, action: ActionOf<"key">): Promise<void> {
  const script = buildKeyScript(action.key, action.ref, tab.generation, action.modifiers);
  if (action.ref) {
    if (await refuseUngrantedRef(id, tab, "key")) return;
    await finishAct(id, tab, "key", script);
    return;
  }
  await approveAndAct(id, tab, "key", undefined, script, describeKey(action.key, action.modifiers));
}

function dispatchAct(id: string, tab: BrowserTarget, action: ActAction): Promise<void> {
  switch (action.operation) {
    case "click":
      return actClick(id, tab, action);
    case "type":
      return actType(id, tab, action);
    case "scroll":
      return actScroll(id, tab, action);
    case "key":
      return actKey(id, tab, action);
  }
}

/** `vmark.browser.act` — click / type / scroll / key by `{ref}` or `{role, name}`. */
export async function handleBrowserAct(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = await resolveBrowserTarget(id, args);
    if (!tab) return;
    const parsed = parseActAction(args);
    if (!parsed.ok) {
      await respond({ id, success: false, error: parsed.error });
      return;
    }
    if (!(await requireHumanAttachment(id, tab))) return;
    await dispatchAct(id, tab, parsed.action);
  });
}
