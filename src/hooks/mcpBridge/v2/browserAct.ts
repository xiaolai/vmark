/**
 * MCP v2 `vmark.browser.act` handler (WI-2.5 / WI-P2.2 / WI-P4.2).
 *
 * Extracted from browser.ts (audit #9) so the act path — the most complex MCP
 * handler — lives in its own file. `act` performs `click` / `type` / `scroll` /
 * `key`, targeting either a precise `{ref}` (from a prior read; honored only on
 * the already-granted path) or ARIA `{role, name}` (through the approval flow).
 *
 * **The check here is advisory.** The authoritative gate is the Rust driver
 * (browser/authorize.rs): it re-checks the operation against the tab's committed
 * origin and rejects a stale generation. `scroll`/`key` dispatch SYNTHETIC DOM
 * events (SPIKE-3), so a site gating on `event.isTrusted` ignores them.
 *
 * @coordinates-with src-tauri browser/authorize.rs — the authoritative gate
 * @coordinates-with lib/browser/agent/actScript.ts / interactScript.ts — the scripts
 * @module hooks/mcpBridge/v2/browserAct
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
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
import { originForAgent } from "@/lib/browser/url";
import {
  browserEnabled,
  readTabIdArg,
  resolveBrowserTab,
  type BrowserTarget,
} from "./browserHelpers";
import { requireHumanAttachment, parseEvalResult } from "./browserReadClass";

type ActOp = "click" | "type" | "scroll" | "key";
/** Which result flag means the action actually landed (not merely evaluated). */
const SUCCESS_FLAG: Record<ActOp, string> = {
  click: "clicked",
  type: "typed",
  scroll: "scrolled",
  key: "dispatched",
};

function actionSucceeded(operation: ActOp, result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  return (result as Record<string, unknown>)[SUCCESS_FLAG[operation]] === true;
}

/** Invoke browser_eval for a built act `script` and report the ACTION outcome.
 *  `target` binds a one-shot on the role/name path; ref/scroll/key pass none. */
async function finishAct(
  id: string,
  tab: BrowserTarget,
  operation: ActOp,
  script: string,
  target?: { role: string; name: string },
): Promise<void> {
  const approvals = useBrowserApprovalStore.getState();
  const raw = await invoke<string>("browser_eval", {
    tabId: tab.tabId,
    script,
    operation,
    generation: tab.generation,
    ...(target ?? {}),
  });
  const humanAct =
    tab.automationMode === "human" && approvals.isHumanTabAttached(tab.tabId, tab.generation);
  if (humanAct) approvals.consumeHumanTabAttachment(tab.tabId, tab.generation);
  const result = parseEvalResult(raw);
  if (!actionSucceeded(operation, result)) {
    await respond({ id, success: false, error: `${operation} did not affect the target`, data: { result } });
    return;
  }
  await respond({ id, success: true, data: { result } });
}

/** Run the approval flow (grant → one-shot → needs-approval), then act. `target`
 *  is the role/name binding, or undefined for a target-less op (scroll/key). */
async function approveAndAct(
  id: string,
  tab: BrowserTarget,
  operation: ActOp,
  target: { role: string; name: string } | undefined,
  script: string,
): Promise<void> {
  const approvals = useBrowserApprovalStore.getState();
  const decision = approvals.decide(tab.url, operation);
  if (decision === "denied") {
    await respond({ id, success: false, error: `operation '${operation}' is not permitted` });
    return;
  }
  if (decision === "needs-approval") {
    const authorizedOnce = useBrowserApprovalStore.getState().consumeOneShot(tab.url, operation, target, tab.tabId);
    if (!authorizedOnce) {
      useBrowserApprovalStore.getState().requestApproval(id, tab.url, operation, target, tab.tabId, tab.generation);
      await respond({
        id,
        success: false,
        error: `approval required: '${operation}' on ${originForAgent(tab.url)}`,
        data: { needsApproval: true, operation, url: originForAgent(tab.url), tabId: tab.tabId, generation: tab.generation },
      });
      return;
    }
  }
  await finishAct(id, tab, operation, script, target);
}

/** Refuse a ref action that is not covered by a standing grant (an approval must
 *  show the user a legible element, not a bare ref). Returns whether it refused. */
async function refuseUngrantedRef(id: string, tab: BrowserTarget, operation: ActOp): Promise<boolean> {
  if (useBrowserApprovalStore.getState().decide(tab.url, operation) === "allowed") return false;
  await respond({
    id,
    success: false,
    error:
      `ref actions need a standing grant for '${operation}' on ${originForAgent(tab.url)}; ` +
      "for a one-time approval retry with role+name so the user can see the element",
    data: { operation, url: originForAgent(tab.url), tabId: tab.tabId, generation: tab.generation },
  });
  return true;
}

function readModifiers(m: unknown): KeyModifiers | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  const o = m as Record<string, unknown>;
  return { ctrl: o.ctrl === true, shift: o.shift === true, alt: o.alt === true, meta: o.meta === true };
}

async function handleScroll(id: string, tab: BrowserTarget, args: Record<string, unknown>): Promise<void> {
  const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref : "";
  const dy = typeof args.dy === "number" && Number.isFinite(args.dy) ? args.dy : undefined;
  if (ref && dy !== undefined) {
    await respond({ id, success: false, error: "scroll takes either {ref} or {dy}, not both" });
    return;
  }
  if (!ref && dy === undefined) {
    await respond({ id, success: false, error: "scroll requires a {ref} (from read) or a numeric {dy} pixel delta" });
    return;
  }
  if (ref) {
    if (await refuseUngrantedRef(id, tab, "scroll")) return;
    await finishAct(id, tab, "scroll", buildScrollToRefScript(ref, tab.generation));
    return;
  }
  await approveAndAct(id, tab, "scroll", undefined, buildScrollByScript(dy as number));
}

async function handleKey(id: string, tab: BrowserTarget, args: Record<string, unknown>): Promise<void> {
  const key = typeof args.key === "string" && args.key.length > 0 ? args.key : "";
  if (!key) {
    await respond({ id, success: false, error: "key requires a non-empty 'key' name (e.g. 'Enter', 'Escape', 'Tab')" });
    return;
  }
  const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref : null;
  const script = buildKeyScript(key, ref, tab.generation, readModifiers(args.modifiers));
  if (ref) {
    if (await refuseUngrantedRef(id, tab, "key")) return;
    await finishAct(id, tab, "key", script);
    return;
  }
  await approveAndAct(id, tab, "key", undefined, script);
}

/** `vmark.browser.act` — click / type / scroll / key by `{ref}` or `{role, name}`. */
export async function handleBrowserAct(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!browserEnabled()) {
      await respond({ id, success: false, error: "BROWSER_DISABLED" });
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
    if (!(await requireHumanAttachment(id, tab))) return;
    const operation = typeof args.operation === "string" ? args.operation : "";
    if (operation !== "click" && operation !== "type" && operation !== "scroll" && operation !== "key") {
      await respond({ id, success: false, error: `act supports 'click', 'type', 'scroll', 'key', not '${operation}'` });
      return;
    }
    if (operation === "scroll") return handleScroll(id, tab, args);
    if (operation === "key") return handleKey(id, tab, args);

    // click / type — targeted by {ref} (granted-only) or {role, name} (approval-legible).
    const role = typeof args.role === "string" ? args.role : "";
    const name = typeof args.name === "string" ? args.name : "";
    const ref = typeof args.ref === "string" ? args.ref : "";
    if (operation === "type" && typeof args.text !== "string") {
      await respond({
        id,
        success: false,
        error: "type requires a string 'text' (pass \"\" to intentionally clear the field)",
      });
      return;
    }
    const wantsRef = ref.trim().length > 0;
    if (wantsRef && (role.trim() || name.trim())) {
      await respond({ id, success: false, error: "act takes either {ref} or {role, name}, not both" });
      return;
    }
    if (wantsRef) {
      if (await refuseUngrantedRef(id, tab, operation)) return;
      const script =
        operation === "type"
          ? buildTypeByRefScript(ref, args.text as string, tab.generation)
          : buildClickByRefScript(ref, tab.generation);
      await finishAct(id, tab, operation, script);
      return;
    }
    if (!role.trim() || !name.trim()) {
      await respond({ id, success: false, error: "act requires {ref} or a non-empty role and name" });
      return;
    }
    const script =
      operation === "type" ? buildTypeScript(role, name, args.text as string) : buildClickScript(role, name);
    await approveAndAct(id, tab, operation, { role, name }, script);
  });
}
