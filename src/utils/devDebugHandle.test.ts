// WI-4.0 — the DEV-only `window.__VMARK_DEBUG__` seam.
//
// This exists because the E2E harness cannot reach the app any other way. The
// debug bridge exposes only `list_windows` / `execute_js` /
// `capture_native_screenshot`; webview-emitted Tauri events never reach the app's
// own `listen()` handlers (verified with a NON-browser control event), and
// synthetic keyboard events do not reach the keybinding layer. So a UI-lane
// journey has no way to invoke a command — unless the app publishes one.
//
// The invariant that makes it safe to have more than one publisher: MERGE, never
// replace. The pre-existing publisher assigned the whole object, so a second one
// would silently erase `editorView` (or be erased by it) on the next editor
// change — an intermittent failure that would look like a flaky harness.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { publishDebugHandle, readDebugHandle } from "./devDebugHandle";

declare global {
  interface Window {
    __VMARK_DEBUG__?: Record<string, unknown>;
  }
}

beforeEach(() => {
  delete window.__VMARK_DEBUG__;
  vi.unstubAllEnvs();
});

describe("publishDebugHandle", () => {
  it("creates the handle on first publish", () => {
    publishDebugHandle("alpha", 1);
    expect(window.__VMARK_DEBUG__).toEqual({ alpha: 1 });
  });

  it("MERGES rather than replacing — two publishers coexist", () => {
    // The whole point: the editor view publisher and the command publisher must
    // not erase each other.
    publishDebugHandle("editorView", "view-1");
    publishDebugHandle("runCommand", "fn");
    expect(window.__VMARK_DEBUG__).toEqual({ editorView: "view-1", runCommand: "fn" });
  });

  it("keeps other keys when one is republished", () => {
    // The editor view is republished on every editor change; that must not drop
    // a command handle registered once at bootstrap.
    publishDebugHandle("runCommand", "fn");
    publishDebugHandle("editorView", "view-1");
    publishDebugHandle("editorView", "view-2");
    expect(window.__VMARK_DEBUG__).toEqual({ editorView: "view-2", runCommand: "fn" });
  });

  it("stores null without dropping the key", () => {
    // `editorView` is legitimately null when no editor is mounted; that is a
    // value, not an absence.
    publishDebugHandle("editorView", null);
    expect(window.__VMARK_DEBUG__).toHaveProperty("editorView", null);
  });

  it("reads back a published handle, and undefined for an absent one", () => {
    publishDebugHandle("alpha", 42);
    expect(readDebugHandle("alpha")).toBe(42);
    expect(readDebugHandle("missing")).toBeUndefined();
  });

  it("is inert in a production build", () => {
    // A debug seam that shipped would let any page script in the app webview
    // drive commands. It must compile to nothing outside DEV.
    vi.stubEnv("DEV", false);
    publishDebugHandle("alpha", 1);
    expect(window.__VMARK_DEBUG__).toBeUndefined();
  });
});
