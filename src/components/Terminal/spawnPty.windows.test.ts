// WI-WCR2 — an explicit code-block interpreter cannot fall back to another shell.
import { beforeEach, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { spawn } from "@/lib/pty";
import { spawnPty } from "./spawnPty";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/pty", () => ({ spawn: vi.fn() }));
vi.mock("@/stores/documentStore", () => ({ useDocumentStore: { getState: () => ({ getDocument: () => null }) } }));
vi.mock("@/stores/tabStore", () => ({ useTabStore: { getState: () => ({ activeTabId: {} }) } }));
vi.mock("./terminalSpawnEnv", () => ({
  resolveLoginShellPath: async () => undefined,
  buildBaseTerminalEnv: () => ({}),
  buildShellSpawnConfig: async () => ({ args: [], env: {} }),
}));
vi.mock("./windowsCodeBlockShell", () => ({ resolveWindowsCodeBlockShell: async () => "C:/Windows/System32/cmd.exe" }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: { getState: () => ({ terminal: { shell: "/bin/zsh", shellIntegration: false } }) } }));

beforeEach(() => { vi.clearAllMocks(); });
it("uses the requested interpreter and surfaces failure without global-shell fallback", async () => {
  vi.mocked(spawn).mockReturnValue({ onData: vi.fn(), onExit: vi.fn(), ready: Promise.reject(new Error("CMD failed")) } as unknown as ReturnType<typeof spawn>);
  const disposed = () => false;
  await expect(spawnPty({ term: { cols: 80, rows: 24, write: vi.fn(), onData: () => ({ dispose: vi.fn() }) } as unknown as Terminal, onExit: vi.fn(), disposed, windowsShell: "cmd", codeBlockSource: "echo 中文" })).rejects.toThrow("CMD failed");
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledWith("C:/Windows/System32/cmd.exe", [], expect.objectContaining({ codeBlock: { shell: "cmd", source: "echo 中文" }, isDisposed: disposed }));
  expect(invoke).not.toHaveBeenCalledWith("get_default_shell");
});

it("forwards ConPTY's cursor-query reply while the code-block PTY is still starting", async () => {
  let ready!: () => void;
  const pty = { onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), ready: new Promise<void>(resolve => { ready = resolve; }) };
  vi.mocked(spawn).mockReturnValue(pty as unknown as ReturnType<typeof spawn>);
  let reply!: (data: string) => void;
  const dispose = vi.fn();
  const term = { cols: 80, rows: 24, write: vi.fn(), onData: vi.fn(listener => { reply = listener; return { dispose }; }) };
  const starting = spawnPty({ term: term as unknown as Terminal, onExit: vi.fn(), disposed: () => false, windowsShell: "cmd", codeBlockSource: "echo hello" });
  await vi.waitFor(() => expect(term.onData).toHaveBeenCalled());
  reply("\x1b[1;1R");
  expect(pty.write).toHaveBeenCalledWith("\x1b[1;1R");
  ready();
  await starting;
  expect(dispose).toHaveBeenCalledOnce();
});
