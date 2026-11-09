// WI-WCR1 — Windows Run reuses the active internal session, creating only when needed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resetTerminalSessionStore, useTerminalStore } from "@/stores/terminalStore";
import { useUIStore } from "@/stores/uiStore";
const context = vi.hoisted(() => ({ filePath: "E:\\notes\\demo.md" as string | null, rootPath: "E:\\workspace" as string | null }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/stores/tabStore", () => ({ useTabStore: { getState: () => ({ activeTabId: { main: "doc" } }) } }));
vi.mock("@/stores/documentStore", () => ({ useDocumentStore: { getState: () => ({ getDocument: () => ({ filePath: context.filePath }) }) } }));
vi.mock("@/services/workspaces/activeWorkspaceScope", () => ({ getActiveWorkspaceScope: () => ({ rootPath: context.rootPath }) }));
import { runWindowsCodeBlock, windowsCodeBlockShell } from "./runWindowsCodeBlock";
import { registerCodeBlockTerminalResolver } from "./activeTerminal";
beforeEach(() => {
  resetTerminalSessionStore();
  useUIStore.setState({ terminalVisible: false });
  vi.mocked(invoke).mockClear();
  context.filePath = "E:\\notes\\demo.md";
  context.rootPath = "E:\\workspace";
});
describe("Windows shell selection", () => {
  it.each(["powershell", "ps1", " PowerShell "])("maps %s to PowerShell", language => expect(windowsCodeBlockShell(language)).toBe("powershell"));
  it.each(["cmd", "bat", "batch", " DOS "])("maps %s to CMD", language => expect(windowsCodeBlockShell(language)).toBe("cmd"));
  it.each(["python", "py", "python3", " Python "])("maps %s to Python", language => expect(windowsCodeBlockShell(language)).toBe("python"));
  it.each(["", "bash", "javascript", "powershellrc", "batman"])("rejects %s", language => expect(windowsCodeBlockShell(language)).toBeNull());
});
describe("internal Windows execution", () => {
  it("opens the panel and waits until its dedicated session sent the source", async () => {
    const source = "Write-Output '中文 & %PATH%'\r\nWrite-Output second";
    const request = runWindowsCodeBlock(source, "ps1");
    const [session] = useTerminalStore.getState().sessions;
    expect(session).toMatchObject({ windowsShell: "powershell", pendingCode: source, requestedCwd: "e:/notes" });
    expect(useUIStore.getState().terminalVisible).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    useTerminalStore.getState().terminalClearPendingCode(session.id);
    expect(await request).toEqual({ ok: true });
    expect(useTerminalStore.getState().sessions[0].windowsShell).toBe("powershell");
  });
  it("reuses the active terminal across languages and repeated runs", async () => {
    const existing = useTerminalStore.getState().terminalCreateSession()!;
    const run = vi.fn().mockResolvedValue(undefined);
    const focus = vi.fn();
    const unregister = registerCodeBlockTerminalResolver(id => id === existing.id ? { run, focus } : null);
    try {
      expect(await runWindowsCodeBlock("echo hello", "bat")).toEqual({ ok: true });
      expect(await runWindowsCodeBlock("Write-Output '中文'", "ps1")).toEqual({ ok: true });
      expect(run.mock.calls).toEqual([["cmd", "echo hello"], ["powershell", "Write-Output '中文'"]]);
      expect(focus).toHaveBeenCalledTimes(2);
      expect(useTerminalStore.getState().sessions.map(s => s.id)).toEqual([existing.id]);
      expect(useUIStore.getState().terminalVisible).toBe(true);
    } finally { unregister(); }
  });
  it("reuses the selected terminal even at the session limit", async () => {
    for (let i = 0; i < 5; i++) useTerminalStore.getState().terminalCreateSession();
    const selected = useTerminalStore.getState().sessions[1];
    useTerminalStore.getState().terminalSetActiveSession(selected.id);
    const run = vi.fn().mockResolvedValue(undefined);
    const unregister = registerCodeBlockTerminalResolver(id => id === selected.id ? { run, focus: vi.fn() } : null);
    try {
      expect(await runWindowsCodeBlock("print('hello')", "python")).toEqual({ ok: true });
      expect(run).toHaveBeenCalledWith("python", "print('hello')");
      expect(useTerminalStore.getState().sessions).toHaveLength(5);
      expect(useTerminalStore.getState().activeSessionId).toBe(selected.id);
    } finally { unregister(); }
  });
  it("reports a reused terminal launch error without adding a session", async () => {
    const existing = useTerminalStore.getState().terminalCreateSession()!;
    const unregister = registerCodeBlockTerminalResolver(() => ({ run: vi.fn().mockRejectedValue(new Error("closed")), focus: vi.fn() }));
    try {
      expect(await runWindowsCodeBlock("echo hello", "cmd")).toEqual({ ok: false, reason: "launch-failed" });
      expect(useTerminalStore.getState().sessions.map(s => s.id)).toEqual([existing.id]);
    } finally { unregister(); }
  });
  it("waits for startup and stays pinned if the active terminal changes", async () => {
    vi.useFakeTimers();
    const existing = useTerminalStore.getState().terminalCreateSession()!;
    let ready = false;
    const run = vi.fn().mockResolvedValue(undefined);
    const unregister = registerCodeBlockTerminalResolver(id => ready && id === existing.id ? { run, focus: vi.fn() } : null);
    try {
      const request = runWindowsCodeBlock("echo pinned", "cmd");
      useTerminalStore.getState().terminalCreateSession();
      ready = true;
      await vi.advanceTimersByTimeAsync(50);
      expect(await request).toEqual({ ok: true });
      expect(run).toHaveBeenCalledOnce();
      expect(useTerminalStore.getState().sessions).toHaveLength(2);
    } finally { unregister(); vi.useRealTimers(); }
  });
  it("does not replace a terminal removed while waiting for startup", async () => {
    vi.useFakeTimers();
    const existing = useTerminalStore.getState().terminalCreateSession()!;
    try {
      const request = runWindowsCodeBlock("echo hello", "cmd");
      useTerminalStore.getState().terminalRemoveSession(existing.id);
      await vi.advanceTimersByTimeAsync(50);
      expect(await request).toEqual({ ok: false, reason: "launch-failed" });
      expect(useTerminalStore.getState().sessions).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it("reports failed shell startup", async () => {
    const request = runWindowsCodeBlock("echo hello", "cmd");
    useTerminalStore.getState().terminalMarkSessionDead(useTerminalStore.getState().activeSessionId!);
    expect(await request).toEqual({ ok: false, reason: "launch-failed" });
  });
  it("honors the five-session limit", async () => {
    for (let i = 0; i < 5; i++) {
      const session = useTerminalStore.getState().terminalCreateSession()!;
      useTerminalStore.getState().terminalMarkSessionDead(session.id);
    }
    expect(await runWindowsCodeBlock("echo hello", "cmd")).toEqual({ ok: false, reason: "max-sessions" });
    expect(useTerminalStore.getState().sessions).toHaveLength(5);
  });
  it("keeps a drive-root file anchored to its drive", async () => {
    context.filePath = "C:\\demo.md";
    const request = runWindowsCodeBlock("echo hello", "cmd");
    const session = useTerminalStore.getState().sessions[0];
    expect(session.requestedCwd).toBe("c:/");
    useTerminalStore.getState().terminalClearPendingCode(session.id);
    await request;
  });
  it.each(["", " \r\n\t"])("does not create a session for empty source", async source => {
    expect(await runWindowsCodeBlock(source, "cmd")).toEqual({ ok: false, reason: "empty" });
    expect(useTerminalStore.getState().sessions).toHaveLength(0);
  });
});
