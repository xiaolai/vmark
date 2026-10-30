/**
 * Purpose: `vmark.session.get_state` — one-shot orientation for AI agents.
 *   Replaces five legacy discovery tools (get_capabilities,
 *   get_document_revision, tabs.list, workspace.get_focused,
 *   workspace.list_windows) with a single call that returns every window,
 *   every tab, and per-tab metadata including a revision token.
 *
 * Origin: MCP pruning plan (retired) ADR-6.
 *
 * Key decisions:
 *   - Each webview answers for its own window only: its tab store holds no
 *     other window's tabs. The Rust bridge sends this request to every
 *     document window and keeps, from each answer, the record carrying that
 *     window's label (#1612) — so the payload built here is one window's part.
 *   - The per-tab and per-window serialization, the human-tab privacy rule and
 *     the protocol gate live in `sessionSerializers.ts`; this
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
 *   - The request handler flushes the mounted editors before the state is
 *     built. Each tab's `dirty` flag and kind are read from the store, which
 *     trails the editor by a debounce; without the flush a tab the user is
 *     typing in is reported clean.
 *
 * @coordinates-with services/mcpBridge/v2/sessionSerializers.ts — tab + window records
 * @coordinates-with services/mcpBridge/v2/liveEditor.ts — the flush
 * @coordinates-with services/mcpBridge/v2/readOperationArgs.ts — the one payload parse
 * @coordinates-with services/mcpBridge/focusedWindow.ts — real focused window
 * @coordinates-with src-tauri/src/mcp_bridge/session_fanout.rs — asks every window, merges
 * @module services/mcpBridge/v2/session
 */

import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { resolveFocusedWindowLabel } from "@/services/mcpBridge/focusedWindow";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { flushLiveEditors } from "./liveEditor";
import { readOperationArgs } from "./readOperationArgs";
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
  const ownLabel = getCurrentWindowLabel();
  const focusedLabel = osFocusedLabel === undefined ? ownLabel : osFocusedLabel;
  return {
    // Exactly this webview's own window — present even with no tabs (a fresh
    // Welcome window), never another window's leftover store entry. The
    // bridge merges every window's answer (#1612).
    windows: [serializeWindow(ownLabel, focusedLabel, includeBrowserTabs)],
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
  args: Record<string, unknown> = {},
): Promise<void> {
  return wrapHandler(id, async () => {
    const { clientProtocol } = readOperationArgs("vmark.session.get_state", args);
    // Ask the platform which window is actually on screen; this webview may not
    // be it (#1208).
    const focusedLabel = await resolveFocusedWindowLabel();
    // Last before the stores are read, so what is reported is what the user has.
    flushLiveEditors();
    const state = buildSessionState(appVersion, clientProtocol, focusedLabel);
    await respond({ id, success: true, data: state });
  });
}
