// #1354 — Windows swallowed keystrokes after Ctrl+C: muda's predefined
// clipboard menu items register Ctrl+C/X/V/A in the Win32 accelerator table
// (intercepting the REAL keystroke before WebView2 sees it) and then re-emit
// it via SendInput — whose synthetic Ctrl-up, fired while the user still
// physically holds Ctrl, desyncs Chromium's modifier state: later typed
// characters arrive as phantom-Ctrl chords and vanish, and paste mistargets,
// until a focus cycle resets the webview. The fix replaces those items on
// Windows with accelerator-FREE menu items routed through these CommandBus
// commands, so the physical shortcuts flow natively to WebView2.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerClipboardCommands, resolveClipboardSurface } from "./clipboardCommands";
import { executeCommand, hasCommand } from "./CommandBus";
import { useUIStore } from "@/stores/uiStore";

describe("clipboard commands (#1354)", () => {
  const execSpy = vi.fn();

  beforeEach(() => {
    registerClipboardCommands();
    // jsdom has no execCommand; the bridge's non-mac fallback calls it, so
    // the DOM API is the boundary we fake — every store and service runs real.
    (document as { execCommand?: unknown }).execCommand = execSpy;
    execSpy.mockClear();
    useUIStore.setState({ sourceMode: false });
  });

  afterEach(() => {
    delete (document as { execCommand?: unknown }).execCommand;
  });

  it("registers all four edit commands exactly once", () => {
    for (const id of ["edit.cut", "edit.copy", "edit.paste", "edit.selectAll"]) {
      expect(hasCommand(id), id).toBe(true);
    }
    // Idempotent under HMR re-registration.
    registerClipboardCommands();
    expect(hasCommand("edit.copy")).toBe(true);
  });

  it.each([
    ["edit.cut", "cut"],
    ["edit.copy", "copy"],
    ["edit.selectAll", "selectAll"],
  ])("%s reaches the webview edit fallback as execCommand(%s)", async (id, domCommand) => {
    await executeCommand(id, undefined, { windowLabel: "main" });
    expect(execSpy).toHaveBeenCalledWith(domCommand);
  });

  it("edit.paste with an empty clipboard is a quiet no-op (fallback path)", async () => {
    // setup.ts mocks plugin-clipboard-manager; readText yields nothing, so
    // the paste fallback bails without dispatching anywhere.
    await expect(
      executeCommand("edit.paste", undefined, { windowLabel: "main" }),
    ).resolves.not.toThrow();
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("resolves the surface from the live mode — source pane when sourceMode is on", () => {
    expect(resolveClipboardSurface()).toBe("wysiwyg");
    useUIStore.setState({ sourceMode: true });
    expect(resolveClipboardSurface()).toBe("source");
    useUIStore.setState({ sourceMode: false });
  });
});
