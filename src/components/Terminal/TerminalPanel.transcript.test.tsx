/**
 * TerminalPanel — rendered-transcript wiring (WI-TP3.3).
 *
 * The audit flagged the path from `terminal.transcriptPreview` through hook
 * configuration and following to the tab-bar toggle and the region as an
 * untested critical path: each piece is tested alone, so broken wiring here
 * would pass them all.
 *
 * The panel's collaborators run for real: the session hook (which spawns the
 * shell and prepares its transcript binding), the transcript follower, the
 * tab bar and its toggle. The boundaries are xterm.js, the PTY and Tauri
 * `invoke` — the transcript arrives as `terminal_transcript_read` deltas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, fireEvent } from "@testing-library/react";

const tauri = vi.hoisted(() => ({
  transcript: "",
  reads: [] as Array<{ token: string }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    element = document.createElement("div");
    textarea: HTMLTextAreaElement | undefined = undefined;
    parser = { registerOscHandler: vi.fn(), registerEscHandler: vi.fn(() => ({ dispose: vi.fn() })), registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })) };
    // Floating-prompt subscriptions (setupFloatingPrompt).
    onScroll = vi.fn(() => ({ dispose: vi.fn() }));
    onWriteParsed = vi.fn(() => ({ dispose: vi.fn() }));
    onCursorMove = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    unicode = { activeVersion: "6" };
    buffer = { active: { viewportY: 0, length: 0, getLine: () => undefined }, onBufferChange: vi.fn(() => ({ dispose: vi.fn() })) };
    modes = { bracketedPasteMode: false };
    options = {};
    cols = 80;
    rows = 24;
    open = vi.fn((container: HTMLElement) => {
      const textarea = document.createElement("textarea");
      container.appendChild(textarea);
      this.textarea = textarea;
    });
    refresh = vi.fn();
    loadAddon = vi.fn();
    dispose = vi.fn();
    focus = vi.fn();
    // xterm parses asynchronously and reports completion; the shell waits on it.
    write = vi.fn((_data: string, parsed?: () => void) => parsed?.());
    writeln = vi.fn();
    clear = vi.fn();
    reset = vi.fn();
    resize = vi.fn();
    scrollToBottom = vi.fn();
    clearSelection = vi.fn();
    selectAll = vi.fn();
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => "");
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onBell = vi.fn(() => ({ dispose: vi.fn() }));
    onTitleChange = vi.fn(() => ({ dispose: vi.fn() }));
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    attachCustomKeyEventHandler = vi.fn();
    registerLinkProvider = vi.fn();
    registerMarker = vi.fn(() => undefined);
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    clearTextureAtlas = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: { token: string; cursor: unknown }) => {
    if (cmd === "get_default_shell") return Promise.resolve("/bin/zsh");
    if (cmd === "terminal_transcript_prepare") return Promise.resolve("tok-1");
    if (cmd === "terminal_transcript_read") {
      tauri.reads.push({ token: args!.token });
      const cursor = { identity: "t", offset: tauri.transcript.length, size: tauri.transcript.length, modified: "m" };
      return Promise.resolve(args!.cursor ? { cursor, reset: false, data: "" } : { cursor, reset: true, data: tauri.transcript });
    }
    return Promise.resolve(null);
  }),
}));
vi.mock("@/plugins/mermaid", () => ({ renderMermaid: vi.fn().mockResolvedValue(null) }));
vi.mock("./useTranscriptConfiguration", () => ({ useTranscriptConfiguration: (enabled: boolean) => (enabled ? "ready" : "pending") }));

import { TerminalPanel } from "./TerminalPanel";
import { useUIStore } from "@/stores/uiStore";
import { resetTerminalSessionStore, useTerminalStore } from "@/stores/terminalStore";
import { useSettingsStore } from "@/stores/settingsStore";

const TABLE_REPLY =
  JSON.stringify({
    type: "assistant",
    uuid: "m",
    message: { role: "assistant", content: [{ type: "text", text: "| A |\n| - |\n| 1 |" }] },
  }) + "\n";

const toggle = () => document.querySelector<HTMLButtonElement>('[data-terminal-action="transcript"]');
const region = () => document.querySelector(".terminal-transcript");

/** Let the shell spawn, bind its transcript, and the follower poll once more. */
async function followOnePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  tauri.transcript = "";
  tauri.reads.length = 0;
  useUIStore.setState({ terminalVisible: true, terminalHeight: 200, terminalWidth: 300, effectiveTerminalPosition: "bottom" } as never);
  resetTerminalSessionStore();
  useTerminalStore.getState().terminalCreateSession();
  useSettingsStore.getState().updateTerminalSetting("transcriptPreview", false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalPanel — rendered transcript wiring", () => {
  it("offers no toggle and no region while the setting is off, and follows nothing", async () => {
    render(<TerminalPanel />);
    await followOnePoll();

    expect(toggle()).toBeNull();
    expect(region()).toBeNull();
    expect(tauri.reads).toEqual([]);
  });

  it("follows the active session's transcript and offers a collapsed toggle once enabled", async () => {
    useSettingsStore.getState().updateTerminalSetting("transcriptPreview", true);
    render(<TerminalPanel />);
    await followOnePoll();

    expect(tauri.reads.length).toBeGreaterThan(0);
    expect(tauri.reads.every((r) => r.token === "tok-1")).toBe(true);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(region()).toBeNull();

    fireEvent.click(toggle()!);
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(region()).not.toBeNull();
  });

  it("renders the region the toggle controls, with the followed messages, while expanded", async () => {
    useSettingsStore.getState().updateTerminalSetting("transcriptPreview", true);
    tauri.transcript = TABLE_REPLY;
    render(<TerminalPanel />);
    await followOnePoll();

    fireEvent.click(toggle()!);

    const shown = region();
    expect(shown).not.toBeNull();
    expect(toggle()).toHaveAttribute("aria-controls", shown!.getAttribute("id"));
    expect(shown!.querySelector("table")).toHaveTextContent("1");
    // Beside the CLI for a bottom panel.
    expect(document.querySelector(".terminal-sessions-container")).toHaveClass("terminal-sessions-container--row");
  });
});
