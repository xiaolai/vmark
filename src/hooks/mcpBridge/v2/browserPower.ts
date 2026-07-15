/**
 * MCP v2 scripted power tools (WI-P5.1 / P5.2 / P5.3): `query`, `style`,
 * `execute_js`.
 *
 * All three run in the driver's ISOLATED content world (DOM + CSS, never the
 * page's JS heap/globals). `query` is read-class; `style` is act-class (op
 * `style`, grantable); `execute_js` is the escape hatch — op `eval`, approved
 * PER CALL only (never a standing grant, enforced authoritatively in Rust), and
 * its return value is flagged untrusted and never auto-fed into a later act
 * (ADR-A6). The Rust driver (browser/authorize.rs) is the authoritative gate.
 *
 * @coordinates-with src-tauri browser/authorize.rs — the authoritative gate
 * @coordinates-with lib/browser/agent/powerScript.ts — the query/style scripts
 * @module hooks/mcpBridge/v2/browserPower
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import {
  buildQueryScript,
  buildStyleScript,
  type QueryFields,
  type StyleOps,
} from "@/lib/browser/agent/powerScript";
import { urlForAgent } from "@/lib/browser/url";
import { browserEnabled, readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";
import { requireHumanAttachment, runReadClass, parseEvalResult } from "./browserReadClass";

function readFields(f: unknown): QueryFields | undefined {
  if (typeof f !== "object" || f === null) return undefined;
  const o = f as Record<string, unknown>;
  const out: QueryFields = {};
  if (o.attributes === true) out.attributes = true;
  if (o.box === true) out.box = true;
  if (Array.isArray(o.styles)) out.styles = o.styles.filter((s): s is string => typeof s === "string");
  return out;
}

/** `vmark.browser.query` — structured DOM detection by CSS selector (read-class). */
export async function handleBrowserQuery(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const selector = typeof args.selector === "string" && args.selector.trim() ? args.selector : "";
    if (!selector) {
      await respond({ id, success: false, error: "query requires a non-empty CSS 'selector'" });
      return;
    }
    const fields = readFields(args.fields);
    await runReadClass<string>(id, args, {
      invoke: (tab) =>
        invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildQueryScript(selector, tab.generation, fields),
          operation: "read",
          generation: tab.generation,
        }),
      data: (tab, raw) => {
        const r = parseEvalResult(raw);
        return { url: urlForAgent(tab.url), ...(typeof r === "object" && r !== null ? r : { result: r }) };
      },
    });
  });
}

/** Common preamble for the two write-class power tools: feature gate, tab
 *  resolution, and the human-attachment gate. Returns the tab, or null (the
 *  refusal has already been sent). */
async function resolveForWrite(id: string, args: Record<string, unknown>): Promise<BrowserTarget | null> {
  if (!browserEnabled()) {
    await respond({ id, success: false, error: "BROWSER_DISABLED" });
    return null;
  }
  const tabIdArg = readTabIdArg(args);
  if (tabIdArg === null) {
    await respond({ id, success: false, error: "tabId must be a non-empty string when supplied" });
    return null;
  }
  const tab = resolveBrowserTab(tabIdArg);
  if (!tab) {
    await respond({ id, success: false, error: "no active browser tab" });
    return null;
  }
  if (!(await requireHumanAttachment(id, tab))) return null;
  return tab;
}

/** Approval flow for a target-less op (style, eval). Returns true if authorized
 *  (may proceed). `extraData` is folded into the needs-approval envelope. */
async function approveOp(
  id: string,
  tab: BrowserTarget,
  operation: string,
  // The EXACT script that will run (for `style`/`eval`) — bound into the one-shot so
  // an approved payload cannot be swapped on the retry. (Security review P5, High #1.)
  script: string | undefined,
  extraData?: Record<string, unknown>,
): Promise<boolean> {
  const decision = useBrowserApprovalStore.getState().decide(tab.url, operation);
  if (decision === "denied") {
    await respond({ id, success: false, error: `operation '${operation}' is not permitted` });
    return false;
  }
  if (decision === "needs-approval") {
    const ok = useBrowserApprovalStore
      .getState()
      .consumeOneShot(tab.url, operation, undefined, tab.tabId, script);
    if (!ok) {
      useBrowserApprovalStore
        .getState()
        .requestApproval(id, tab.url, operation, undefined, tab.tabId, tab.generation, script);
      await respond({
        id,
        success: false,
        error: `approval required: '${operation}' on ${urlForAgent(tab.url)}`,
        data: { needsApproval: true, operation, url: urlForAgent(tab.url), tabId: tab.tabId, generation: tab.generation, ...extraData },
      });
      return false;
    }
  }
  return true;
}

function readStyleOps(args: Record<string, unknown>): StyleOps | null {
  const ops: StyleOps = {};
  if (typeof args.set === "object" && args.set !== null) {
    ops.set = {};
    for (const [k, v] of Object.entries(args.set as Record<string, unknown>)) {
      if (typeof v === "string") ops.set[k] = v;
    }
  }
  if (Array.isArray(args.addClasses)) ops.addClasses = args.addClasses.filter((s): s is string => typeof s === "string");
  if (Array.isArray(args.removeClasses)) ops.removeClasses = args.removeClasses.filter((s): s is string => typeof s === "string");
  if (typeof args.injectCss === "string" && args.injectCss.length > 0) ops.injectCss = args.injectCss;
  const hasOp =
    (ops.set && Object.keys(ops.set).length) || ops.addClasses?.length || ops.removeClasses?.length || ops.injectCss;
  return hasOp ? ops : null;
}

/** `vmark.browser.style` — isolated-world CSS manipulation (act-class, op `style`). */
export async function handleBrowserStyle(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = await resolveForWrite(id, args);
    if (!tab) return;
    const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref : undefined;
    const selector = typeof args.selector === "string" && args.selector.trim() ? args.selector : undefined;
    const ops = readStyleOps(args);
    if (!ops) {
      await respond({ id, success: false, error: "style requires one of: set, addClasses, removeClasses, or injectCss" });
      return;
    }
    if (!ref && !selector && !ops.injectCss) {
      await respond({ id, success: false, error: "style requires a {ref} or {selector} (injectCss needs neither)" });
      return;
    }
    // Build the exact script BEFORE approval so the one-shot binds this payload — a
    // later retry with different ops rebuilds a different script and is refused rather
    // than riding the prior approval. (Security review P5, High #1 / Medium #4.)
    const script = buildStyleScript({ ref, selector }, tab.generation, ops);
    if (!(await approveOp(id, tab, "style", script))) return;
    const raw = await invoke<string>("browser_eval", {
      tabId: tab.tabId,
      script,
      operation: "style",
      generation: tab.generation,
    });
    const approvals = useBrowserApprovalStore.getState();
    if (tab.automationMode === "human" && approvals.isHumanTabAttached(tab.tabId, tab.generation)) {
      approvals.consumeHumanTabAttachment(tab.tabId, tab.generation);
    }
    await respond({ id, success: true, data: { result: parseEvalResult(raw) } });
  });
}

/** `vmark.browser.execute_js` — the escape hatch. An arbitrary isolated-world
 *  script, op `eval`: approved PER CALL only (never a standing grant), the
 *  script shown in the approval envelope, the result flagged untrusted (ADR-A6). */
export async function handleBrowserExecuteJs(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = await resolveForWrite(id, args);
    if (!tab) return;
    const script = typeof args.script === "string" && args.script.trim() ? args.script : "";
    if (!script) {
      await respond({ id, success: false, error: "execute_js requires a non-empty 'script' string" });
      return;
    }
    // The approval envelope shows the exact script (truncated) — the user must see
    // what they authorize — and the FULL script is bound into the one-shot, so an
    // approved script cannot be swapped for another on the retry. `eval` is never
    // grantable, so this is always per-call. (Security review P5, High #1.)
    if (!(await approveOp(id, tab, "eval", script, { script: script.slice(0, 2000) }))) return;
    const raw = await invoke<string>("browser_eval", {
      tabId: tab.tabId,
      script,
      operation: "eval",
      generation: tab.generation,
    });
    const approvals = useBrowserApprovalStore.getState();
    if (tab.automationMode === "human" && approvals.isHumanTabAttached(tab.tabId, tab.generation)) {
      approvals.consumeHumanTabAttachment(tab.tabId, tab.generation);
    }
    // The result is page-derived and UNTRUSTED — never auto-feed it into a later act.
    await respond({ id, success: true, data: { result: parseEvalResult(raw), untrusted: true } });
  });
}
