/**
 * MCP v2 scripted power tools (WI-P5.2 / P5.3): `style` and `execute_js`
 * (`query` moved to `browserQuery.ts` for the file-size gate and is re-exported).
 *
 * All three run in the driver's ISOLATED content world (DOM + CSS, never the
 * page's JS heap/globals). `query` is read-class; `style` is act-class (op
 * `style`, grantable); `execute_js` is the escape hatch — op `eval`, approved
 * PER CALL only (never a standing grant, enforced authoritatively in Rust), and
 * its return value is flagged untrusted and never auto-fed into a later act
 * (ADR-A6). The Rust driver (browser/authorize.rs) is the authoritative gate.
 *
 * Ordering rule: payload validation runs BEFORE the human-attachment gate, so
 * malformed or oversized requests can never queue an attachment prompt.
 *
 * @coordinates-with src-tauri browser/authorize.rs — the authoritative gate
 * @coordinates-with lib/browser/agent/powerScript.ts — the query/style scripts
 * @coordinates-with services/mcpBridge/v2/browserApprovalFlow.ts — the shared approval machine
 * @coordinates-with services/mcpBridge/v2/browserAccess.ts — gate + tab resolution + attachment mirror
 * @module services/mcpBridge/v2/browserPower
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { buildStyleScript } from "@/lib/browser/agent/powerScript";
import { MAX_SCRIPT_BYTES, utf8ByteLength, type BrowserTarget } from "./browserHelpers";
import { invokeAttached, resolveBrowserTarget } from "./browserAccess";
import { authorizeOperation } from "./browserApprovalFlow";
import { readStyleOps } from "./browserStyleOps";
import { requireHumanAttachment, parseEvalResult } from "./browserReadClass";

export { handleBrowserQuery } from "./browserQuery";
import { readOperationArgs } from "./readOperationArgs";
import { unwrapExecuteJsResult, wrapExecuteJsScript } from "./browserExecuteJs";

/**
 * The shared tail of both write-class tools: attachment gate → approval →
 * native invoke → response. The approval is the shared state machine
 * (`browserApprovalFlow`) with the EXACT script bound into the one-shot, so an
 * approved payload cannot be swapped on the retry (security review P5, High #1);
 * `extraEnvelope` is folded into its needs-approval envelope. The attachment
 * mirror follows the driver through `invokeAttached` (`browserAccess.ts`): spent
 * on success, reconciled to the driver's own attachment report after a
 * rejection. A driver rejection propagates to `wrapHandler` as its typed token.
 */
async function runWriteOp(
  id: string,
  tab: BrowserTarget,
  operation: "style" | "eval",
  script: string,
  extraEnvelope: Record<string, unknown> | undefined,
  data: (raw: string) => Record<string, unknown>,
): Promise<void> {
  if (!(await requireHumanAttachment(id, tab))) return;
  const outcome = await authorizeOperation(id, tab, {
    operation,
    script,
    ...(extraEnvelope ? { promptData: extraEnvelope } : {}),
  });
  if (outcome !== "authorized") return;
  const raw = await invokeAttached(tab, () =>
    invoke<string>("browser_eval", {
      tabId: tab.tabId,
      script,
      operation,
      generation: tab.generation,
    }),
  );
  await respond({ id, success: true, data: data(raw) });
}

/** `vmark.browser.style` — isolated-world CSS manipulation (act-class, op `style`). */
export async function handleBrowserStyle(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    // Gate + tab first; payload validation and the attachment gate come AFTER
    // (the ordering rule in the header).
    const tab = await resolveBrowserTarget(id, args);
    if (!tab) return;
    const wire = readOperationArgs("vmark.browser.style", args);
    const ref = typeof wire.ref === "string" && wire.ref.trim() ? wire.ref : undefined;
    const selector = typeof wire.selector === "string" && wire.selector.trim() ? wire.selector : undefined;
    if (ref && selector) {
      await respond({ id, success: false, error: "style takes {ref} OR {selector}, not both" });
      return;
    }
    const parsed = readStyleOps(args);
    if ("error" in parsed) {
      await respond({ id, success: false, error: parsed.error });
      return;
    }
    const ops = parsed.ops;
    if (!ref && !selector && !ops.injectCss) {
      await respond({ id, success: false, error: "style requires a {ref} or {selector} (injectCss needs neither)" });
      return;
    }
    if (ops.injectCss && utf8ByteLength(ops.injectCss) > MAX_SCRIPT_BYTES) {
      await respond({ id, success: false, error: `style injectCss exceeds the ${MAX_SCRIPT_BYTES}-byte limit` });
      return;
    }
    // Build the exact script BEFORE approval so the one-shot binds this payload — a
    // later retry with different ops rebuilds a different script and is refused rather
    // than riding the prior approval. (Security review P5, High #1 / Medium #4.)
    // Only the targeting key the caller actually supplied: the script builder
    // branches on which one is PRESENT, and a `selector: undefined` alongside
    // a ref would claim the caller asked to target both.
    const script = buildStyleScript(
      { ...(ref ? { ref } : {}), ...(selector ? { selector } : {}) },
      tab.generation,
      ops,
    );
    // Rust's authoritative gate measures the BUILT script, not the raw CSS —
    // check the same thing here so near-limit CSS is refused with a clear
    // client-side error instead of an opaque rejection after wrapping.
    if (utf8ByteLength(script) > MAX_SCRIPT_BYTES) {
      await respond({ id, success: false, error: `style script (wrapped CSS) exceeds the ${MAX_SCRIPT_BYTES}-byte limit` });
      return;
    }
    await runWriteOp(id, tab, "style", script, undefined, (raw) => ({ result: parseEvalResult(raw) }));
  });
}

/** `vmark.browser.execute_js` — the escape hatch. An arbitrary isolated-world
 *  script, op `eval`: approved PER CALL only (never a standing grant), the
 *  script shown in the approval envelope, the result flagged untrusted (ADR-A6).
 *
 *  The USER'S script is what the prompt shows and what the one-shot binds — but
 *  what runs is `wrapExecuteJsScript(script)`: the driver returns strings only
 *  (a non-string result came back as Apple's `description` text and a throw as
 *  `<null>` with success — audit E-04), so the wrapper JSON-encodes the value and
 *  reports a throw as a failure. Both layers bind the WRAPPED script's hash: the
 *  wrapper is deterministic, so an approved script still cannot be swapped. */
export async function handleBrowserExecuteJs(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = await resolveBrowserTarget(id, args);
    if (!tab) return;
    const wire = readOperationArgs("vmark.browser.execute_js", args);
    const script = typeof wire.script === "string" && wire.script.trim() ? wire.script : "";
    if (!script) {
      await respond({ id, success: false, error: "execute_js requires a non-empty 'script' string" });
      return;
    }
    if (utf8ByteLength(script) > MAX_SCRIPT_BYTES) {
      await respond({ id, success: false, error: `execute_js script exceeds the ${MAX_SCRIPT_BYTES}-byte limit` });
      return;
    }
    const wrapped = wrapExecuteJsScript(script);
    if (utf8ByteLength(wrapped) > MAX_SCRIPT_BYTES) {
      await respond({ id, success: false, error: `execute_js script (wrapped) exceeds the ${MAX_SCRIPT_BYTES}-byte limit` });
      return;
    }
    // The approval envelope shows the exact script (truncated) — the user must see
    // what they authorize — and the FULL wrapped script is bound into the one-shot,
    // so an approved script cannot be swapped for another on the retry. `eval` is
    // never grantable, so this is always per-call. (Security review P5, High #1.)
    // The result is page-derived and UNTRUSTED — never auto-feed it into a later act.
    await runWriteOp(id, tab, "eval", wrapped, { script: script.slice(0, 2000) }, (raw) => {
      const outcome = unwrapExecuteJsResult(raw);
      if (!outcome.ok) throw new Error(`script threw: ${outcome.error}`);
      return { result: outcome.value, untrusted: true };
    });
  });
}
