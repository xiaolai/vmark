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
 * Ordering rule: payload validation runs BEFORE the human-attachment gate, so
 * malformed or oversized requests can never queue an attachment prompt.
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
} from "@/lib/browser/agent/powerScript";
import { urlForAgent, originForAgent } from "@/lib/browser/url";
import { browserEnabled, readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";
import { readStyleOps } from "./browserStyleOps";
import { requireHumanAttachment, runReadClass, parseEvalResult } from "./browserReadClass";

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
        // A script-level failure (invalid selector, …) must be a FAILED
        // response, not a success envelope with an `error` field inside.
        if (typeof r === "object" && r !== null && "error" in r) {
          throw new Error(String((r as { error: unknown }).error));
        }
        return { url: urlForAgent(tab.url), ...(typeof r === "object" && r !== null ? r : { result: r }) };
      },
    });
  });
}

/** Feature gate + tab resolution for the write-class tools. Payload validation
 *  and the attachment gate come AFTER this (see runWriteOp's ordering rule). */
async function resolveWriteTab(id: string, args: Record<string, unknown>): Promise<BrowserTarget | null> {
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
  }
  return true;
}

/**
 * The shared tail of both write-class tools: attachment gate → approval →
 * native invoke → response. The frontend's one-use attachment mirror is
 * consumed in `finally`: Rust consumes ITS attachment during authorization,
 * so a post-authorization failure must still spend the mirror — otherwise the
 * two layers drift permanently out of sync (frontend says attached, Rust
 * refuses).
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
  try {
    const raw = await invoke<string>("browser_eval", {
      tabId: tab.tabId,
      script,
      operation,
      generation: tab.generation,
    });
    await respond({ id, success: true, data: data(raw) });
  } finally {
    const approvals = useBrowserApprovalStore.getState();
    if (tab.automationMode === "human" && approvals.isHumanTabAttached(tab.tabId, tab.generation)) {
      approvals.consumeHumanTabAttachment(tab.tabId, tab.generation);
    }
  }
}

/** `vmark.browser.style` — isolated-world CSS manipulation (act-class, op `style`). */
export async function handleBrowserStyle(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = await resolveWriteTab(id, args);
    if (!tab) return;
    const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref : undefined;
    const selector = typeof args.selector === "string" && args.selector.trim() ? args.selector : undefined;
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
    const script = buildStyleScript({ ref, selector }, tab.generation, ops);
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
 *  script shown in the approval envelope, the result flagged untrusted (ADR-A6). */
export async function handleBrowserExecuteJs(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const tab = await resolveWriteTab(id, args);
    if (!tab) return;
    const script = typeof args.script === "string" && args.script.trim() ? args.script : "";
    if (!script) {
      await respond({ id, success: false, error: "execute_js requires a non-empty 'script' string" });
      return;
    }
    if (utf8ByteLength(script) > MAX_SCRIPT_BYTES) {
      await respond({ id, success: false, error: `execute_js script exceeds the ${MAX_SCRIPT_BYTES}-byte limit` });
      return;
    }
    // The approval envelope shows the exact script (truncated) — the user must see
    // what they authorize — and the FULL script is bound into the one-shot, so an
    // approved script cannot be swapped for another on the retry. `eval` is never
    // grantable, so this is always per-call. (Security review P5, High #1.)
    // The result is page-derived and UNTRUSTED — never auto-feed it into a later act.
    await runWriteOp(id, tab, "eval", script, { script: script.slice(0, 2000) }, (raw) => ({
      result: parseEvalResult(raw),
      untrusted: true,
    }));
  });
}
