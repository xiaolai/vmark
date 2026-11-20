// WI-WCR2 — an explicit code-block interpreter never falls back to another shell.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resolveWindowsCodeBlockShell } from "./windowsCodeBlockShell";
beforeEach(() => { vi.mocked(invoke).mockReset(); });
describe("Windows code-block interpreter", () => {
  it.each([["cmd", "C:\\Windows\\System32\\cmd.exe"], ["powershell", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"]] as const)("selects %s from offered absolute paths", async (kind, path) => {
    vi.mocked(invoke).mockResolvedValue(["C:\\other\\pwsh.exe", path]);
    expect(await resolveWindowsCodeBlockShell(kind)).toBe(path);
  });
  it("does not substitute CMD when PowerShell is missing", async () => {
    vi.mocked(invoke).mockResolvedValue(["C:\\Windows\\System32\\cmd.exe"]);
    await expect(resolveWindowsCodeBlockShell("powershell")).rejects.toThrow();
  });
  it("hosts Python execution in the offered PowerShell PTY", async () => {
    const path = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
    vi.mocked(invoke).mockResolvedValue([path]);
    expect(await resolveWindowsCodeBlockShell("python")).toBe(path);
  });
});
