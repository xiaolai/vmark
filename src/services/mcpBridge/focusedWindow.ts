/**
 * Which window the USER is looking at (#1208).
 *
 * Purpose: the bridge routes a request to whichever window owns the relevant
 * workspace, so the webview answering an MCP call is frequently NOT the window
 * on screen. `session.get_state` used to derive its `focused` flag from its own
 * label, which made the payload assert that the responding window was the
 * focused one — true in a single-window session, a lie in a restored
 * multi-window one, and precisely why "MCP reports success but the UI never
 * follows" was undiagnosable from the client side.
 *
 * The three-valued return is the point: a label, `null` for "resolved: no VMark
 * window holds focus", and `undefined` for "could not find out". Only the last
 * one may fall back to a guess.
 *
 * @coordinates-with services/mcpBridge/v2/session.ts — the sole consumer
 * @module services/mcpBridge/focusedWindow
 */
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";

/**
 * The focused window's label, `null` when none is focused, or `undefined` when
 * the platform could not answer.
 */
export async function resolveFocusedWindowLabel(): Promise<string | null | undefined> {
  try {
    const windows = await getAllWebviewWindows();
    for (const window of windows) {
      if (await window.isFocused()) return window.label;
    }
    return null;
  } catch {
    // Never throw from a status query: an unresolvable focus degrades the
    // payload's precision, it does not fail the request.
    return undefined;
  }
}
