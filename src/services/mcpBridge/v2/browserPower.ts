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
 * @module services/mcpBridge/v2/browserPower
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { buildStyleScript } from "@/lib/browser/agent/powerScript";
import { originForAgent } from "@/lib/browser/url";
import { grantPatternFor } from "@/stores/browserApprovalStore.helpers";
import { mintOneShotConfirmed } from "@/services/browser/grantSync";
import { readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";
import { browserGate, invokeAttached } from "./browserAccess";
import { readStyleOps } from "./browserStyleOps";
import { requireHumanAttachment, parseEvalResult } from "./browserReadClass";

export { handleBrowserQuery } from "./browserQuery";
import { readOperationArgs } from "./readOperationArgs";
import { unwrapExecuteJsResult, wrapExecuteJsScript } from "./browserExecuteJs";

/**
 * Cap on a caller-supplied script / CSS payload. The AI client is UNTRUSTED, and
 * an approved payload is retained verbatim in `PendingApproval` and rendered in the
 * approval dialog — so an unbounded stream of large scripts would grow the store
 * and make the dialog expensive to render. 64 KiB is far above any legitimate
 * automation snippet. (Security review P5 re-verify — High #1 availability.)
 */
const MAX_SCRIPT_BYTES = 64 * 1024;

/**
 * Measure a string in UTF-8 BYTES, which is what `MAX_SCRIPT_BYTES` names.
 *
 * `String.length` counts UTF-16 code units, so a CJK or emoji payload passes a
 * `.length` check at up to ~3x the stated byte cap. Rust's `browser_eval` has
 * the authoritative limit (browser/script_limit.rs); this check exists so a
 * near-limit payload fails HERE with a clear client-side error instead of an
 * opaque driver rejection.
 */
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Feature gate + tab resolution for the write-class tools. Payload validation
 *  and the attachment gate come AFTER this (see runWriteOp's ordering rule). */
async function resolveWriteTab(id: string, args: Record<string, unknown>): Promise<BrowserTarget | null> {
  if (!(await browserGate(id))) return null;
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
      .consumeOneShot(tab.url, operation, undefined, tab.tabId, script, tab.generation);
    if (!ok) {
      const queued = useBrowserApprovalStore
        .getState()
        .requestApproval(id, tab.url, operation, undefined, tab.tabId, tab.generation, script);
      // No prompt was queued: advertising `needsApproval` would point the
      // client at an approval that does not exist and can never resolve.
      if (queued === "overloaded" || queued === "rejected") {
        await respond({
          id,
          success: false,
          error:
            queued === "overloaded"
              ? "approval queue is full — resolve or deny pending approvals, then retry"
              : `operation '${operation}' cannot be approved`,
        });
        return false;
      }
      // Origin-only in the pre-authorization envelope — the path can carry a token.
      const origin = originForAgent(tab.url);
      await respond({
        id,
        success: false,
        error: `approval required: '${operation}' on ${origin}`,
        data: { needsApproval: true, operation, url: origin, tabId: tab.tabId, generation: tab.generation, ...extraData },
      });
      return false;
    }
    // The mirror copy is spent; act only once the driver confirms its copy exists
    // (one mint path — audit A-04), else the eval is refused as unauthorized.
    const pattern = grantPatternFor(tab.url);
    const minted =
      pattern !== null &&
      (await mintOneShotConfirmed({
        originPattern: pattern,
        operation,
        tabId: tab.tabId,
        generation: tab.generation,
        ...(script !== undefined ? { script } : {}),
      }));
    if (!minted) {
      await respond({
        id,
        success: false,
        error: `the driver refused the '${operation}' authorization — the page may have navigated; retry to be prompted again`,
      });
      return false;
    }
  }
  return true;
}

/**
 * The shared tail of both write-class tools: attachment gate → approval →
 * native invoke → response. The attachment mirror follows the driver's consume
 * through `invokeAttached` (`browserAccess.ts`): spent on success and on any
 * post-authorization failure, kept on a pre-authorization refusal. A driver
 * rejection propagates to `wrapHandler` as its typed token.
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
  if (!(await approveOp(id, tab, operation, script, extraEnvelope))) return;
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
    const tab = await resolveWriteTab(id, args);
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
    const tab = await resolveWriteTab(id, args);
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
