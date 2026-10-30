/**
 * MCP Bridge — top-level request router.
 *
 * Routes every MCP bridge request to `dispatchV2`, whose routed namespaces
 * are `SUPPORTED_TOOL_PREFIXES` (session, workspace, document, workflow,
 * selection, comments, browser). Unrecognized
 * request types respond with a diagnostic `Unknown request type` that
 * names the supported tool prefixes — so a sidecar/app version mismatch
 * (issue #900) is identifiable from the error string alone, without
 * grepping logs.
 *
 * Every dispatched request gets one immutable `McpWriteContext` (who is
 * behind it), built here from the request's attribution and threaded through
 * `dispatchV2` to the handlers that change a document. An attribution that
 * does not validate is refused with an error reply before any handler runs.
 *
 * Trust boundary: provenance, certificates, capture ids, hunks and spans are
 * produced inside the webview by its own collectors, never by an MCP client.
 * A request whose arguments carry one of those keys is refused, naming the
 * key, before any handler runs and whatever the operation's unknown-field
 * posture: `readOperationArgs` only logs undeclared fields, which would
 * silently drop the key rather than refuse it. No contract declares these
 * keys (`provenanceTrustBoundary.test.ts`), so no version of a client sends
 * them and the refusal cannot break version skew.
 *
 * Origin: MCP pruning plan (retired).
 *
 * @coordinates-with utils.ts — respond()
 * @coordinates-with writeContext.ts — createMcpWriteContext
 * @coordinates-with v2/dispatch.ts — dispatchV2
 * @coordinates-with types.ts — McpRequestEvent
 * @module services/mcpBridge/handleRequest
 */

import type { McpRequestEvent } from "./types";
import { respond } from "./utils";
import { createMcpWriteContext } from "./writeContext";
import { isTargetDocReadOnly } from "@/services/editor/readOnlyGuard";
import { dispatchV2, SUPPORTED_TOOL_PREFIXES } from "@/services/mcpBridge/v2/dispatch";
import { v2ErrorString } from "@/services/mcpBridge/v2/types";
import { errorMessage } from "@/utils/errorMessage";

const READ_ONLY_BLOCKED = new Set<string>([
  "vmark.document.write",
  "vmark.document.transform",
  "vmark.workflow.apply_patch",
  "vmark.selection.set",
]);

/** Argument keys only the webview's own collectors produce. */
const TRUST_RESERVED_KEYS = ["capture", "certificate", "hunks", "provenance", "spans"] as const;

/** The trust-reserved keys `args` carries, sorted. */
function reservedKeysIn(args: unknown): string[] {
  if (typeof args !== "object" || args === null) return [];
  return TRUST_RESERVED_KEYS.filter((key) => Object.hasOwn(args, key));
}

/** Route an MCP request through the v2 dispatcher. */
export async function handleRequest(event: McpRequestEvent): Promise<void> {
  const { id, type } = event;

  try {
    // First, before any request-specific decision: an unattributable
    // request is refused as such, whatever it asks for.
    const context = createMcpWriteContext(event);

    const reserved = reservedKeysIn(event.args);
    if (reserved.length > 0) {
      await respond({
        id,
        success: false,
        error:
          `Refused: argument(s) ${reserved.map((k) => `'${k}'`).join(", ")} are reserved. ` +
          "Provenance, certificates, captures, hunks and spans are recorded by VMark itself " +
          "and are never accepted from an MCP client; resend without them.",
      });
      return;
    }

    // Gate on the tab the mutation TARGETS, not the active one. These
    // request types accept a `tabId`, so an active-tab check let writes to
    // read-only background tabs through and refused writes to writable ones.
    // `selection.set` may name a tabId too (its handler then requires it to be
    // the focused tab); without one the check falls back to the active tab.
    if (READ_ONLY_BLOCKED.has(type) && isTargetDocReadOnly(event.args?.tabId)) {
      await respond({
        id,
        success: false,
        error: v2ErrorString({
          error: "READ_ONLY",
          message: "Document is read-only",
        }),
      });
      return;
    }

    if (await dispatchV2(event, context)) return;
    // Diagnostic suffix exposes the contract this VMark build advertises
    // so version-mismatch failures (#900) name themselves.
    await respond({
      id,
      success: false,
      error:
        `Unknown request type: ${type}. ` +
        `This VMark build supports: ${SUPPORTED_TOOL_PREFIXES.join(", ")}. ` +
        `If the requested type follows that shape, your sidecar may be a different version than the VMark app — restart both.`,
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: errorMessage(error),
    });
  }
}
