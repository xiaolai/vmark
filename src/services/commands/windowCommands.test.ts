// @vitest-environment node
// WI-FL3.10 — `window.bringAllToFront` is the handler behind the macOS Window →
// Bring All to Front item, which emitted `menu:bring-all-to-front` to nothing.
// AppKit semantics: every visible, non-minimized window of the app is ordered
// to the front; minimized windows stay in the Dock; the window the user was in
// ends up on top (it is focused LAST).
import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeWindow {
  label: string;
  isVisible: () => Promise<boolean>;
  isMinimized: () => Promise<boolean>;
  setFocus: () => Promise<void>;
}

const focusOrder: string[] = [];
function fakeWindow(label: string, opts: { visible?: boolean; minimized?: boolean } = {}): FakeWindow {
  return {
    label,
    isVisible: vi.fn(async () => opts.visible ?? true),
    isMinimized: vi.fn(async () => opts.minimized ?? false),
    setFocus: vi.fn(async () => {
      focusOrder.push(label);
    }),
  };
}

let windows: FakeWindow[] = [];
let current: FakeWindow;
/** Set to make enumeration REJECT — the one await that used to escape (#949). */
let enumerateError: Error | null = null;
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getAllWebviewWindows: async () => {
    if (enumerateError) throw enumerateError;
    return windows;
  },
  getCurrentWebviewWindow: () => current,
}));

import { registerWindowCommands } from "./windowCommands";
import { executeCommand, getCommand, registerCommand, _resetCommandBus } from "./CommandBus";

beforeEach(() => {
  _resetCommandBus();
  focusOrder.length = 0;
  enumerateError = null;
  registerWindowCommands();
});

describe("window.bringAllToFront (WI-FL3.10)", () => {
  it("registers idempotently", () => {
    expect(getCommand("window.bringAllToFront")).toBeDefined();
    expect(() => registerWindowCommands()).not.toThrow();
  });

  it("focuses every visible window and the current one last, so it stays on top", async () => {
    current = fakeWindow("main");
    const other = fakeWindow("doc-2");
    const settings = fakeWindow("settings");
    windows = [other, current, settings];

    await executeCommand("window.bringAllToFront", null, { windowLabel: "main" });

    expect(focusOrder).toEqual(["doc-2", "settings", "main"]);
    expect(current.setFocus).toHaveBeenCalledTimes(1);
  });

  it("leaves minimized and hidden windows alone (a hidden helper window must never be shown)", async () => {
    current = fakeWindow("main");
    const minimized = fakeWindow("doc-3", { minimized: true });
    const hidden = fakeWindow("pdf-export-1", { visible: false });
    windows = [current, minimized, hidden];

    await executeCommand("window.bringAllToFront", null, { windowLabel: "main" });

    expect(minimized.setFocus).not.toHaveBeenCalled();
    expect(hidden.setFocus).not.toHaveBeenCalled();
    expect(focusOrder).toEqual(["main"]);
  });

  it("still raises the current window when it is the only one", async () => {
    current = fakeWindow("main");
    windows = [current];

    await executeCommand("window.bringAllToFront", null, { windowLabel: "main" });

    expect(focusOrder).toEqual(["main"]);
  });

  // Audit 20260907 (#460): the final focus of the CURRENT window sat outside the
  // per-window guard, so a window closing mid-operation rejected the whole
  // command after the others had already been rearranged.
  it("still resolves when the current window's own focus fails (it may be closing)", async () => {
    current = fakeWindow("main");
    current.setFocus = vi.fn(async () => {
      throw new Error("window closing");
    });
    const other = fakeWindow("doc-2");
    windows = [other, current];

    await expect(
      executeCommand("window.bringAllToFront", null, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(focusOrder).toEqual(["doc-2"]);
  });

  // Audit 20260907 (#461): a `hasCommand` guard silently kept an identically
  // named command from ANOTHER registrar; owner-based registration refuses it.
  it("refuses a foreign registration of its id instead of silently keeping the impostor", () => {
    _resetCommandBus();
    registerCommand({ id: "window.bringAllToFront", title: "impostor", run: () => {} });
    expect(() => registerWindowCommands()).toThrow(/already registered/);
  });

  it("does not let one window's failure stop the others", async () => {
    current = fakeWindow("main");
    const broken = fakeWindow("doc-9");
    broken.setFocus = vi.fn(async () => {
      throw new Error("window gone");
    });
    const fine = fakeWindow("doc-4");
    windows = [broken, fine, current];

    // Resolves (a rejection here would fail the await) and carries on past the
    // broken window to the healthy ones.
    await executeCommand("window.bringAllToFront", null, { windowLabel: "main" });

    expect(focusOrder).toEqual(["doc-4", "main"]);
  });
});

describe("current-window eligibility (audit #950)", () => {
  it("leaves a minimized current window in the Dock", async () => {
    current = fakeWindow("main", { minimized: true });
    const other = fakeWindow("doc-2");
    windows = [other, current];

    await executeCommand("window.bringAllToFront", null, { windowLabel: "main" });

    // "Minimized windows stay in the Dock" is the command's own invariant, and
    // it must hold for the invoking window too — a minimize that lands while
    // the loop awaits must not be undone by the final focus.
    expect(focusOrder).toEqual(["doc-2"]);
    expect(current.setFocus).not.toHaveBeenCalled();
  });

  it("never orders a hidden current window onscreen", async () => {
    current = fakeWindow("pdf-renderer", { visible: false });
    windows = [current];

    await executeCommand("window.bringAllToFront", null, { windowLabel: "pdf-renderer" });

    expect(focusOrder).toEqual([]);
  });
  // Audit #949 — enumeration was the only await outside a guard, so a rejection
  // there rejected the whole command and skipped the current-window focus,
  // which does not need the enumeration at all.
  it("still focuses the current window when enumeration fails", async () => {
    current = fakeWindow("main");
    windows = [];
    enumerateError = new Error("windows unavailable");

    await expect(
      executeCommand("window.bringAllToFront", null, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(focusOrder).toEqual(["main"]);
  });
});
