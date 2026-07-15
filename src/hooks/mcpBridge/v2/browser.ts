/**
 * MCP v2 `vmark.browser.*` handlers (WI-2.5 / R5).
 *
 * Purpose: expose the live embedded browser to AI clients through the MCP
 * bridge. `read` returns an ARIA snapshot of the current page (via the driver's
 * isolated-world eval, WI-2.1); `act` performs a click/type by ARIA role +
 * accessible name — but only after the operation-based approval gate
 * (browserApprovalStore / grants.ts, R5) allows it. Upload is hard-denied; an
 * un-granted operation is not performed — instead a pending approval is queued
 * and the AI is told approval is required, so the human stays in the loop for
 * anything not pre-authorized.
 *
 * **The check here is advisory, not the security boundary.** The authoritative
 * gate is the Rust driver (`browser/origin_guard.rs`): it re-checks the operation
 * against the tab's COMMITTED origin — read from its own registry, never from this
 * layer — and rejects a command stamped with a stale navigation generation. This
 * layer's job is to keep the human in the loop and to stamp each eval with
 * `operation` + `generation`; if it were skipped entirely, the driver would still
 * refuse anything un-granted.
 *
 * @coordinates-with src-tauri browser/origin_guard.rs — the authoritative R4/R5 gate
 * @coordinates-with src-tauri browser_eval — evaluates the generated scripts
 * @coordinates-with stores/browserApprovalStore.ts — the advisory R5 check + grant source
 * @coordinates-with lib/browser/agent/actScript.ts — snapshot/click/type scripts
 * @module hooks/mcpBridge/v2/browser
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import {
  buildClickScript,
  buildSnapshotScript,
  buildTypeScript,
} from "@/lib/browser/agent/actScript";
import { urlForAgent } from "@/lib/browser/url";
import { browserEnabled, readTabIdArg, resolveBrowserTab } from "./browserHelpers";
import { requireHumanAttachment, runReadClass } from "./browserReadClass";
export {
  handleBrowserNavigate,
  handleBrowserOpen,
  handleBrowserWait,
} from "./browserNavigation";
export { handleBrowserScreenshot } from "./browserScreenshot";

/**
 * Resolve the target browser tab (by id, else the focused window's active tab).
 *
 * `generation` is the navigation generation of the tab's committed page. It
 * stamps every driver command so the Rust gate can reject one authorized against
 * a page that has since navigated. It defaults to 0 — a value the driver refuses
 * — when nothing has committed yet: fail-closed, never invent a plausible stamp.
 */
/**
 * Read an optional `tabId` argument: the id string, `undefined` when absent, or
 * `null` when present-but-invalid (empty, whitespace-only, or non-string).
 *
 * An explicitly-supplied but invalid id must NOT silently fall back to the active
 * tab — that could act on a page the caller never meant. Absent is the only case
 * that legitimately means "use the active tab".
 */
const parse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

/** Whether the parsed act result reports the action actually landed. A completed
 *  eval is not a completed action: `{found:false}`/`{clicked:false}`/`{typed:false}`
 *  (missing, disabled, readonly, non-editable target) is a no-op, not a success. */
function actionSucceeded(operation: "click" | "type", result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const flag = operation === "type" ? "typed" : "clicked";
  return (result as Record<string, unknown>)[flag] === true;
}

/** `vmark.browser.read` — ARIA snapshot of the current page. Args `{tabId?}`.
 *  A read-class op: the shared executor handles the gate/attachment/consume flow. */
export async function handleBrowserRead(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, () =>
    runReadClass<string>(id, args, {
      invoke: (tab) =>
        invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildSnapshotScript(tab.generation),
          operation: "read",
          generation: tab.generation,
        }),
      // Redacted at the trust boundary: credentials in a URL are the one thing about
      // a page the AI could not read out of the DOM anyway (audit, High).
      data: (tab, raw) => ({ url: urlForAgent(tab.url), snapshot: parse(raw) }),
    }),
  );
}

/**
 * `vmark.browser.act` — click/type by ARIA role + name, approval-gated (R5).
 * Args `{tabId?, operation: "click"|"type", role, name, text?}`.
 */
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
    const role = typeof args.role === "string" ? args.role : "";
    const name = typeof args.name === "string" ? args.name : "";

    // `act` performs exactly two things. Without this, EVERY operation that is not
    // "type" fell through to the click script — so an operation authorized as a
    // read would have executed a mutating click.
    if (operation !== "click" && operation !== "type") {
      await respond({
        id,
        success: false,
        error: `act supports 'click' and 'type', not '${operation}'`,
      });
      return;
    }
    // A blank (or whitespace-only) role/name matches the first unnamed element of
    // that role — an unintended click or edit. Refuse rather than guess.
    if (!role.trim() || !name.trim()) {
      await respond({ id, success: false, error: "act requires a non-empty role and name" });
      return;
    }
    // A `type` with no `text` used to default to "" — a silent, destructive field
    // clear. Require the caller to be explicit; an intentional clear passes "".
    if (operation === "type" && typeof args.text !== "string") {
      await respond({
        id,
        success: false,
        error: "type requires a string 'text' (pass \"\" to intentionally clear the field)",
      });
      return;
    }

    const approvals = useBrowserApprovalStore.getState();
    const decision = approvals.decide(tab.url, operation);
    if (decision === "denied") {
      await respond({ id, success: false, error: `operation '${operation}' is not permitted` });
      return;
    }
    if (decision === "needs-approval") {
      // "Allow once" mints a single-use authorization bound to (origin, operation,
      // target). The AI retries under a NEW request id, so it cannot be matched by
      // id — spend it here, immediately before acting, or the approval would
      // authorize nothing and the AI would re-prompt forever. The target binding
      // stops the AI escalating an approved "click Publish" into "click Delete".
      const target = { role, name };
      const authorizedOnce = useBrowserApprovalStore
        .getState()
        .consumeOneShot(tab.url, operation, target, tab.tabId);
      if (!authorizedOnce) {
        useBrowserApprovalStore
          .getState()
          // Stamped with the generation the AI's request was evaluated against, so the
          // approval binds to the page the user is being shown (audit, High).
          .requestApproval(id, tab.url, operation, target, tab.tabId, tab.generation);
        await respond({
          id,
          success: false,
          // `error` is required by the bridge contract: without it the sidecar's
          // `throw new Error(response.error)` produced an EMPTY error and the AI
          // never learned that consent was being asked for. The structured
          // envelope rides alongside for clients that can render it.
          error: `approval required: '${operation}' on ${urlForAgent(tab.url)}`,
          data: {
            needsApproval: true,
            operation,
            url: urlForAgent(tab.url),
            tabId: tab.tabId,
            generation: tab.generation,
          },
        });
        return;
      }
    }

    const script =
      operation === "type"
        ? buildTypeScript(role, name, args.text as string)
        : buildClickScript(role, name);
    const raw = await invoke<string>("browser_eval", {
      tabId: tab.tabId,
      script,
      operation,
      generation: tab.generation,
      // The driver authorizes against this declared target — not by parsing the
      // opaque script — and binds a consumed one-shot to it.
      role,
      name,
    });
    const humanAct =
      tab.automationMode === "human" &&
      approvals.isHumanTabAttached(tab.tabId, tab.generation);
    // Rust consumes the one-shot attachment while authorizing browser_eval.
    // Mirror that consumption after the command succeeds so the next action
    // cannot pass the frontend check and then fail in the driver.
    if (humanAct) approvals.consumeHumanTabAttachment(tab.tabId, tab.generation);
    // Report the ACTION outcome, not merely that the eval completed: a click that
    // hit nothing or a type refused as readonly is a no-op, and telling the AI it
    // succeeded would have it proceed as if the page changed.
    const result = parse(raw);
    if (!actionSucceeded(operation, result)) {
      await respond({
        id,
        success: false,
        error: `${operation} did not affect the target (role='${role}', name='${name}')`,
        data: { result },
      });
      return;
    }
    await respond({ id, success: true, data: { result } });
  });
}
