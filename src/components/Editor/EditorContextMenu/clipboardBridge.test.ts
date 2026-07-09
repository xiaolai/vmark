// WI-2.3 — clipboard bridge: the ADR-3 focus contract (editor refocused
// BEFORE the native command fires), the macOS responder-chain path, and
// the non-macOS / failure fallbacks per surface.
// WI-0.2 — encodes the spike-validated close→refocus→command contract as
// a regression test (order assertion in the first case).

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined as unknown),
  readText: vi.fn(async () => "clip-text"),
  isMacPlatform: vi.fn(() => true),
  execCommand: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: mocks.readText }));
vi.mock("@/utils/platform", () => ({ isMacPlatform: mocks.isMacPlatform }));

import {
  clearContextMenuSourceView,
  focusEditorSurface,
  runClipboardCommand,
  setContextMenuSourceView,
} from "./clipboardBridge";
import { useEditorStore } from "@/stores/editorStore";

function installViews() {
  const calls: string[] = [];
  const wysiwygView = {
    focus: vi.fn(() => calls.push("focus:wysiwyg")),
    pasteText: vi.fn(() => calls.push("pasteText")),
  };
  const sourceView = {
    focus: vi.fn(() => calls.push("focus:source")),
    dispatch: vi.fn(() => calls.push("dispatch")),
    state: { replaceSelection: vi.fn((spec: unknown) => ({ replaced: spec })) },
  };
  useEditorStore.setState((s) => ({
    tiptap: { ...s.tiptap, editorView: wysiwygView as never },
    source: { ...s.source, editorView: sourceView as never },
  }));
  return { wysiwygView, sourceView, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isMacPlatform.mockReturnValue(true);
  mocks.invoke.mockResolvedValue(undefined);
  mocks.readText.mockResolvedValue("clip-text");
  document.execCommand = mocks.execCommand as never;
});

describe("runClipboardCommand — macOS responder chain", () => {
  it("refocuses the WYSIWYG editor before invoking the native command", async () => {
    const { wysiwygView, calls } = installViews();
    mocks.invoke.mockImplementation(async () => {
      calls.push("invoke");
    });
    await runClipboardCommand("paste", "wysiwyg");
    expect(wysiwygView.focus).toHaveBeenCalled();
    expect(calls.indexOf("focus:wysiwyg")).toBeLessThan(calls.indexOf("invoke"));
    expect(mocks.invoke).toHaveBeenCalledWith("trigger_webview_edit", { action: "paste" });
  });

  it("refocuses the source editor for source-surface commands", async () => {
    const { sourceView } = installViews();
    await runClipboardCommand("copy", "source");
    expect(sourceView.focus).toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("trigger_webview_edit", { action: "copy" });
  });

  it("falls back when the native command rejects", async () => {
    installViews();
    mocks.invoke.mockRejectedValue(new Error("no main thread"));
    await runClipboardCommand("copy", "wysiwyg");
    expect(mocks.execCommand).toHaveBeenCalledWith("copy");
  });
});

describe("runClipboardCommand — non-macOS fallbacks", () => {
  beforeEach(() => {
    mocks.isMacPlatform.mockReturnValue(false);
  });

  it("uses execCommand for cut, copy, and selectAll without invoking Rust", async () => {
    installViews();
    await runClipboardCommand("cut", "wysiwyg");
    await runClipboardCommand("copy", "source");
    await runClipboardCommand("selectAll", "wysiwyg");
    expect(mocks.execCommand.mock.calls.map((c) => c[0])).toEqual(["cut", "copy", "selectAll"]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("pastes clipboard text into the WYSIWYG view via pasteText", async () => {
    const { wysiwygView } = installViews();
    await runClipboardCommand("paste", "wysiwyg");
    expect(mocks.readText).toHaveBeenCalled();
    expect(wysiwygView.pasteText).toHaveBeenCalledWith("clip-text");
  });

  it("pastes clipboard text into the source view via replaceSelection", async () => {
    const { sourceView } = installViews();
    await runClipboardCommand("paste", "source");
    expect(sourceView.state.replaceSelection).toHaveBeenCalledWith("clip-text");
    expect(sourceView.dispatch).toHaveBeenCalled();
  });

  it("no-ops paste when the clipboard has no text", async () => {
    const { wysiwygView } = installViews();
    mocks.readText.mockResolvedValue("");
    await runClipboardCommand("paste", "wysiwyg");
    expect(wysiwygView.pasteText).not.toHaveBeenCalled();
  });

  it("survives a clipboard read failure without throwing", async () => {
    const { wysiwygView } = installViews();
    mocks.readText.mockRejectedValue(new Error("denied"));
    await expect(runClipboardCommand("paste", "wysiwyg")).resolves.toBeUndefined();
    expect(wysiwygView.pasteText).not.toHaveBeenCalled();
  });
});

describe("source-view override (SplitPane panes)", () => {
  it("routes source focus and paste to the registered override view", async () => {
    mocks.isMacPlatform.mockReturnValue(false);
    const { sourceView } = installViews();
    const paneView = {
      focus: vi.fn(),
      dispatch: vi.fn(),
      state: { replaceSelection: vi.fn((spec: unknown) => spec) },
    };
    setContextMenuSourceView(paneView as never);
    try {
      focusEditorSurface("source");
      expect(paneView.focus).toHaveBeenCalled();
      expect(sourceView.focus).not.toHaveBeenCalled();

      await runClipboardCommand("paste", "source");
      expect(paneView.state.replaceSelection).toHaveBeenCalledWith("clip-text");
      expect(sourceView.dispatch).not.toHaveBeenCalled();
    } finally {
      clearContextMenuSourceView(paneView as never);
    }
  });

  it("clear only removes the registration for the same view", () => {
    const { sourceView } = installViews();
    const paneA = { focus: vi.fn() };
    const paneB = { focus: vi.fn() };
    setContextMenuSourceView(paneA as never);
    // A stale destroy from another pane must not clobber A's registration.
    clearContextMenuSourceView(paneB as never);
    focusEditorSurface("source");
    expect(paneA.focus).toHaveBeenCalled();

    clearContextMenuSourceView(paneA as never);
    focusEditorSurface("source");
    expect(sourceView.focus).toHaveBeenCalled();
  });
});
