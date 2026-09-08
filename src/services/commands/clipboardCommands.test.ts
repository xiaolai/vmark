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
import { executeCommand, hasCommand, getCommand } from "./CommandBus";
import { useUIStore } from "@/stores/uiStore";
import { useEditorStore } from "@/stores/editorStore";

/** A stand-in for a mounted editor view: presence is what the guard reads,
 *  and the bridge focuses it before running the command. */
const FAKE_VIEW = { focus: () => {}, pasteText: () => {} } as never;

describe("clipboard commands (#1354)", () => {
  const execSpy = vi.fn();

  let originalPlatform = "";

  beforeEach(() => {
    // This suite exercises the NON-mac fallback, so it says so: the test tier models
    // macOS by default (src/test/platformDefault.ts), where the native edit menu
    // handles these and the fallback is never reached.
    originalPlatform = navigator.platform;
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    registerClipboardCommands();
    // jsdom has no execCommand; the bridge's non-mac fallback calls it, so
    // the DOM API is the boundary we fake — every store and service runs real.
    (document as { execCommand?: unknown }).execCommand = execSpy;
    execSpy.mockClear();
    useUIStore.setState({ sourceMode: false });
    // An editing surface is mounted — the ordinary case. The commands are
    // gated on it (#891), so the availability tests below take it away again.
    useEditorStore.setState((state) => ({
      tiptap: { ...state.tiptap, editorView: FAKE_VIEW },
      source: { ...state.source, editorView: null },
    }));
  });

  afterEach(() => {
    useEditorStore.setState((state) => ({
      tiptap: { ...state.tiptap, editorView: null },
      source: { ...state.source, editorView: null },
    }));
    delete (document as { execCommand?: unknown }).execCommand;
    Object.defineProperty(navigator, "platform", { value: originalPlatform, configurable: true });
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

  // Audit #891 — the non-mac fallback is document.execCommand, which acts on
  // whatever DOM node holds focus. With no editor mounted a menu Cut would
  // operate on something else entirely, so the command must be UNAVAILABLE.
  describe("availability follows the resolved surface", () => {
    it("is unavailable when no editor is mounted, and a dispatch is refused", async () => {
      useEditorStore.setState((state) => ({
        tiptap: { ...state.tiptap, editorView: null },
        source: { ...state.source, editorView: null },
      }));

      expect(getCommand("edit.cut")?.when?.({})).toBe(false);
      await expect(
        executeCommand("edit.cut", undefined, { windowLabel: "main" }),
      ).resolves.toBe(false);
      expect(execSpy).not.toHaveBeenCalled();
    });

    it("asks about the SOURCE view when the source pane is showing", () => {
      useUIStore.setState({ sourceMode: true });
      // A mounted WYSIWYG view says nothing about the surface a menu click
      // would target while Source mode is on.
      expect(getCommand("edit.copy")?.when?.({})).toBe(false);

      useEditorStore.setState((state) => ({
        source: { ...state.source, editorView: FAKE_VIEW },
      }));
      expect(getCommand("edit.copy")?.when?.({})).toBe(true);
      useUIStore.setState({ sourceMode: false });
    });
  });

  // Audit #889 — the translation key is derived from the id, so the label and
  // the command it runs cannot drift.
  it("titles resolve for every command id", () => {
    for (const id of ["edit.cut", "edit.copy", "edit.paste", "edit.selectAll"]) {
      const title = getCommand(id)?.title;
      expect(typeof title === "function" ? title() : title, id).toBeTruthy();
    }
  });
});
