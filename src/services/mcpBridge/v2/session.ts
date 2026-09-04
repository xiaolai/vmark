/**
 * Purpose: `vmark.session.get_state` — one-shot orientation for AI agents.
 *   Replaces five legacy discovery tools (get_capabilities,
 *   get_document_revision, tabs.list, workspace.get_focused,
 *   workspace.list_windows) with a single call that returns every window,
 *   every tab, and per-tab metadata including a revision token.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md ADR-6.
 *
 * Key decisions:
 *   - The per-tab and per-window serialization, the human-tab privacy rule and
 *     the protocol gate live in `sessionSerializers.ts` (round 3, #76); this
 *     module composes them into the payload and answers the request.
 *   - `focused` comes from the PLATFORM, not from this webview's own label.
 *     The bridge routes a request to whichever window owns the workspace, so
 *     the responding window is frequently not the one the user is looking at.
 *   - Browser tabs are gated on the protocol the client declares (`clientProtocol`
 *     on the get_state request) and withheld from clients older than 0.3.0 —
 *     including any request that omits the field, which is how a pre-0.3 sidecar
 *     presents itself. The bundled sidecar is version-locked in shipped builds,
 *     so this only matters under version skew (a stale or swapped local sidecar);
 *     the gate closes that case rather than relying on the bundling alone.
 *
 * @coordinates-with services/mcpBridge/v2/sessionSerializers.ts — tab + window records
 * @coordinates-with stores/tabStore.ts — the windows to enumerate
 * @coordinates-with services/mcpBridge/focusedWindow.ts — real focused window
 * @module services/mcpBridge/v2/session
 */

import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { resolveFocusedWindowLabel } from "@/services/mcpBridge/focusedWindow";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import type { SessionState } from "./types";
import { clientSupportsBrowserTabs, serializeWindow } from "./sessionSerializers";

// Bumped to 0.3.0 when browser tabs entered session state.
const MCP_PROTOCOL_VERSION = "0.3.0";

/**
 * Build the session-state payload from current store state.
 *
 * `clientProtocol` is the protocol the requesting client declared; browser tabs
 * are omitted for clients older than 0.3.0 (or that declare nothing).
 *
 * Pure function over store state — exported for unit testing without
 * the bridge `respond` round-trip.
 */
export function buildSessionState(
  appVersion: string,
  clientProtocol?: string,
  osFocusedLabel?: string | null,
): SessionState {
  const includeBrowserTabs = clientSupportsBrowserTabs(clientProtocol);
  // The window the USER is looking at. `undefined` means the caller could not
  // resolve it, and we fall back to the responding window — historical
  // behaviour, so an unresolvable focus degrades rather than blinding a
  // single-window client. `null` is a RESOLVED answer meaning no VMark window
  // holds focus, and must not be flattened into that fallback.
  const focusedLabel =
    osFocusedLabel === undefined ? getCurrentWindowLabel() : osFocusedLabel;
  const windows = Object.keys(useTabStore.getState().tabs).map((label) =>
    serializeWindow(label, focusedLabel, includeBrowserTabs),
  );
  return {
    windows,
    capabilities: {
      version: appVersion,
      supportedKinds: ["markdown", "yaml-workflow"],
      mcpProtocol: MCP_PROTOCOL_VERSION,
    },
  };
}

/**
 * Handle `vmark.session.get_state` requests.
 *
 * The only arg is the optional `clientProtocol` the client declares (a pre-0.3
 * client omits it, and then does not receive browser tabs). Returns the full
 * session state — orientation in one round-trip.
 */
export async function handleSessionGetState(
  id: string,
  appVersion: string,
  args?: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const clientProtocol = typeof args?.clientProtocol === "string" ? args.clientProtocol : undefined;
    // Ask the platform which window is actually on screen; this webview may not
    // be it (#1208).
    const state = buildSessionState(appVersion, clientProtocol, await resolveFocusedWindowLabel());
    await respond({ id, success: true, data: state });
  });
}
