// WI-WCR3 — the real Run facade routes explicit Windows fences to native IPC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useUIStore } from "@/stores/uiStore";
import { resetTerminalSessionStore, useTerminalStore } from "@/stores/terminalStore";
import { runInTerminal } from "./runInTerminal";

beforeEach(() => {
  resetTerminalSessionStore();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("Windows Run routing", () => {
  it.each([["ps1", "powershell"], ["bat", "cmd"], ["python", "python"]])("runs %s in a dedicated embedded session", async (language, shell) => {
    const source = "echo native test\r\necho second line";
    const request = runInTerminal(source, language);
    const session = useTerminalStore.getState().sessions[0];
    expect(session).toMatchObject({ windowsShell: shell, pendingCode: source });
    expect(useUIStore.getState().terminalVisible).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    useTerminalStore.getState().terminalClearPendingCode(session.id);
    expect(await request).toEqual({ ok: true });
  });
  it("keeps Windows execution unavailable on macOS", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(await runInTerminal("echo test", "cmd")).toEqual({ ok: false, reason: "not-shell" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("reports a native launch failure through the existing button result", async () => {
    const request = runInTerminal("echo test", "cmd");
    useTerminalStore.getState().terminalMarkSessionDead(useTerminalStore.getState().activeSessionId!);
    expect(await request).toEqual({ ok: false, reason: "launch-failed" });
  });
});
