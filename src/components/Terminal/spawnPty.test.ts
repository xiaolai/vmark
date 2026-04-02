import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveTerminalCwd,
  spawnPty,
  wirePtyFlowControl,
  CALLBACK_BYTE_LIMIT,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  type FlowControlPty,
  type PtyPayload,
} from "./spawnPty";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_default_shell") return Promise.resolve("/bin/zsh");
    if (cmd === "get_login_shell_path") return Promise.resolve("/usr/local/bin:/usr/bin:/bin");
    return Promise.resolve(null);
  }),
}));

// Mock stores
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: { getState: vi.fn(() => ({ rootPath: null })) },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: vi.fn(() => ({ activeTabId: {} })) },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: vi.fn(() => ({ getDocument: () => null })) },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: vi.fn(() => ({ terminal: { shell: "" } })) },
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/lib/pty", () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })),
}));

import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { spawn } from "@/lib/pty";

describe("resolveTerminalCwd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspace root when available", () => {
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace/root",
    } as ReturnType<typeof useWorkspaceStore.getState>);

    expect(resolveTerminalCwd()).toBe("/workspace/root");
  });

  it("returns active file parent dir when no workspace", () => {
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: null,
    } as ReturnType<typeof useWorkspaceStore.getState>);
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab1" },
    } as unknown as ReturnType<typeof useTabStore.getState>);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: () => ({ filePath: "/Users/test/docs/file.md" }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    expect(resolveTerminalCwd()).toBe("/Users/test/docs");
  });

  it("returns undefined when no workspace and no active file", () => {
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: null,
    } as ReturnType<typeof useWorkspaceStore.getState>);
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: {},
    } as unknown as ReturnType<typeof useTabStore.getState>);

    expect(resolveTerminalCwd()).toBeUndefined();
  });

  it("returns undefined when active file has no path", () => {
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: null,
    } as ReturnType<typeof useWorkspaceStore.getState>);
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab1" },
    } as unknown as ReturnType<typeof useTabStore.getState>);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: () => ({ filePath: null }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    expect(resolveTerminalCwd()).toBeUndefined();
  });
});

describe("wirePtyFlowControl", () => {
  let dataHandler: (data: PtyPayload) => void;
  let writeCallbacks: Array<() => void>;
  let mockPty: FlowControlPty;
  let mockTerm: Pick<import("@xterm/xterm").Terminal, "write">;

  beforeEach(() => {
    writeCallbacks = [];
    mockPty = {
      onData: vi.fn((handler: (e: PtyPayload) => void) => {
        dataHandler = handler;
        return { dispose: vi.fn() };
      }) as unknown as FlowControlPty["onData"],
      pause: vi.fn(),
      resume: vi.fn(),
    };
    mockTerm = {
      write: vi.fn((_data: string | Uint8Array, cb?: () => void) => {
        if (cb) writeCallbacks.push(cb);
      }) as unknown as Pick<import("@xterm/xterm").Terminal, "write">["write"],
    };
  });

  /** Send a chunk of the given byte size through the PTY data handler. */
  function sendChunk(size: number): void {
    dataHandler(new Uint8Array(size));
  }

  /** Send raw data (as received from Tauri IPC) through the PTY data handler. */
  function sendRaw(data: PtyPayload): void {
    dataHandler(data);
  }

  it("writes small chunks directly without callback (fast path)", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    sendChunk(1000);
    expect(mockTerm.write).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(writeCallbacks).toHaveLength(0);
    expect(mockPty.pause).not.toHaveBeenCalled();
  });

  it("skips write when disposed", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => true);

    sendChunk(1000);
    expect(mockTerm.write).not.toHaveBeenCalled();
  });

  it("attaches callback when cumulative bytes exceed CALLBACK_BYTE_LIMIT", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    // First chunk under limit — fast path
    sendChunk(CALLBACK_BYTE_LIMIT - 1);
    expect(writeCallbacks).toHaveLength(0);

    // Second chunk crosses limit — callback path
    sendChunk(2);
    expect(writeCallbacks).toHaveLength(1);
  });

  it("pauses PTY when pending callbacks exceed HIGH_WATERMARK", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    // Each chunk exceeds CALLBACK_BYTE_LIMIT, incrementing pendingCallbacks
    for (let i = 0; i <= HIGH_WATERMARK; i++) {
      sendChunk(CALLBACK_BYTE_LIMIT + 1);
    }

    expect(mockPty.pause).toHaveBeenCalled();
  });

  it("does not pause PTY when pending callbacks are at or below HIGH_WATERMARK", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    // Send exactly HIGH_WATERMARK chunks (pendingCallbacks reaches HIGH_WATERMARK, not exceeding)
    for (let i = 0; i < HIGH_WATERMARK; i++) {
      sendChunk(CALLBACK_BYTE_LIMIT + 1);
    }

    expect(mockPty.pause).not.toHaveBeenCalled();
  });

  it("resumes PTY when pending callbacks drop below LOW_WATERMARK", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    // Build up enough pending callbacks to trigger pause
    for (let i = 0; i <= HIGH_WATERMARK; i++) {
      sendChunk(CALLBACK_BYTE_LIMIT + 1);
    }
    expect(mockPty.pause).toHaveBeenCalled();

    // Flush callbacks until pendingCallbacks drops below LOW_WATERMARK
    // We have HIGH_WATERMARK + 1 callbacks; flush enough to get below LOW_WATERMARK
    const toFlush = writeCallbacks.length - LOW_WATERMARK + 1;
    for (let i = 0; i < toFlush; i++) {
      const cb = writeCallbacks.shift();
      cb?.();
    }

    expect(mockPty.resume).toHaveBeenCalled();
  });

  it("resets byte counter after callback-path write", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    // Cross the limit — triggers callback path and resets written to 0
    sendChunk(CALLBACK_BYTE_LIMIT + 1);
    expect(writeCallbacks).toHaveLength(1);

    // Next small chunk should go fast path (written was reset)
    sendChunk(100);
    expect(writeCallbacks).toHaveLength(1); // no new callback
  });

  it("converts plain number array to Uint8Array for correct UTF-8 decoding", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    // Tauri IPC serializes Vec<u8> as a JSON array of numbers.
    // "中" in UTF-8 is [228, 184, 173].
    const cjkBytes = [228, 184, 173];
    sendRaw(cjkBytes);

    expect(mockTerm.write).toHaveBeenCalledTimes(1);
    const written = vi.mocked(mockTerm.write).mock.calls[0][0];
    expect(written).toBeInstanceOf(Uint8Array);
    expect(Array.from(written as Uint8Array)).toEqual(cjkBytes);
  });

  it("passes Uint8Array through unchanged", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    const original = new Uint8Array([228, 184, 173]);
    sendRaw(original);

    expect(mockTerm.write).toHaveBeenCalledTimes(1);
    const written = vi.mocked(mockTerm.write).mock.calls[0][0];
    expect(written).toBe(original); // exact same reference
  });

  it("drops invalid payload types silently", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    // Simulate unexpected IPC payloads — should be ignored, not crash or write garbage.
    dataHandler("unexpected string" as unknown as PtyPayload);
    dataHandler(null as unknown as PtyPayload);
    dataHandler({} as unknown as PtyPayload);

    expect(mockTerm.write).not.toHaveBeenCalled();
  });

  it("does not resume when callbacks drop but stay at LOW_WATERMARK", () => {
    wirePtyFlowControl(mockPty, mockTerm, () => false);

    // Build up LOW_WATERMARK + 1 pending callbacks (not enough to pause, but enough to test resume threshold)
    for (let i = 0; i < LOW_WATERMARK + 1; i++) {
      sendChunk(CALLBACK_BYTE_LIMIT + 1);
    }

    // Flush one — pendingCallbacks goes from LOW_WATERMARK+1 to LOW_WATERMARK (not below)
    const cb = writeCallbacks.shift();
    cb?.();

    expect(mockPty.resume).not.toHaveBeenCalled();
  });
});

describe("spawnPty shell selection", () => {
  const mockTerm = {
    cols: 80,
    rows: 24,
    write: vi.fn(),
  } as unknown as import("@xterm/xterm").Terminal;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: null,
    } as ReturnType<typeof useWorkspaceStore.getState>);
  });

  it("uses configured shell when set", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "/bin/fish" },
    } as ReturnType<typeof useSettingsStore.getState>);

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    expect(spawn).toHaveBeenCalledWith("/bin/fish", [], expect.any(Object));
    expect(invoke).not.toHaveBeenCalledWith("get_default_shell");
  });

  it("falls back to get_default_shell when shell is empty", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    expect(invoke).toHaveBeenCalledWith("get_default_shell");
    expect(spawn).toHaveBeenCalledWith("/bin/zsh", [], expect.any(Object));
  });

  it("falls back to get_default_shell when shell is whitespace-only", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "  " },
    } as ReturnType<typeof useSettingsStore.getState>);

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    expect(invoke).toHaveBeenCalledWith("get_default_shell");
    expect(spawn).toHaveBeenCalledWith("/bin/zsh", [], expect.any(Object));
  });

  it("retries with default shell when configured shell fails to spawn", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "/usr/bin/nonexistent" },
    } as ReturnType<typeof useSettingsStore.getState>);

    const spawnCalls: string[] = [];
    vi.mocked(spawn).mockImplementation(((shellArg: string) => {
      spawnCalls.push(shellArg);
      if (shellArg === "/usr/bin/nonexistent") {
        throw new Error("spawn failed");
      }
      return {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      };
    }) as unknown as typeof spawn);

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    expect(invoke).toHaveBeenCalledWith("get_default_shell");
    expect(spawnCalls).toEqual(["/usr/bin/nonexistent", "/bin/zsh"]);
  });

  it("sets VMARK_WORKSPACE env when workspace root is available", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/my/workspace",
    } as ReturnType<typeof useWorkspaceStore.getState>);

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    const spawnCallEnv = vi.mocked(spawn).mock.calls[0][2] as { env: Record<string, string> };
    expect(spawnCallEnv.env.VMARK_WORKSPACE).toBe("/my/workspace");
  });

  it("throws original error when spawn fails and no configured shell", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);

    vi.mocked(spawn).mockImplementation((() => {
      throw new Error("spawn failed");
    }) as unknown as typeof spawn);

    await expect(
      spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false }),
    ).rejects.toThrow("spawn failed");
  });

  it("calls onExit callback when PTY exits", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);

    let exitHandler: (e: { exitCode: number }) => void = () => {};
    vi.mocked(spawn).mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn((handler: (e: { exitCode: number }) => void) => {
        exitHandler = handler;
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);

    const onExit = vi.fn();
    await spawnPty({ term: mockTerm, onExit, disposed: () => false });
    exitHandler({ exitCode: 42 });
    expect(onExit).toHaveBeenCalledWith(42);
  });

  it("throws if disposed during fallback await", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "/usr/bin/nonexistent" },
    } as ReturnType<typeof useSettingsStore.getState>);

    vi.mocked(spawn).mockImplementation((() => {
      throw new Error("spawn failed");
    }) as unknown as typeof spawn);

    await expect(
      spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => true }),
    ).rejects.toThrow("disposed");
  });

  it("falls back to /bin/sh when get_default_shell returns a non-absolute path", async () => {
    // L141/142: shellIsAbsolute check — when the resolved shell is relative, use /bin/sh
    vi.mocked(spawn).mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_default_shell") return Promise.resolve("zsh"); // no leading /
      return Promise.resolve(null);
    });

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    expect(spawn).toHaveBeenCalledWith("/bin/sh", [], expect.any(Object));
  });

  it("uses /bin/sh fallback when shell setting is relative path", async () => {
    // L141/142: configuredShell is set but not absolute — safeShell is "", so
    // get_default_shell is called. If that also returns a non-absolute path, use /bin/sh.
    vi.mocked(spawn).mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "bash" }, // relative — not absolute
    } as ReturnType<typeof useSettingsStore.getState>);
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_default_shell") return Promise.resolve("fish"); // also not absolute
      return Promise.resolve(null);
    });

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    expect(spawn).toHaveBeenCalledWith("/bin/sh", [], expect.any(Object));
  });

  it("uses default cols/rows (80/24) when term.cols and term.rows are 0", async () => {
    // L160: term.cols || 80 / term.rows || 24 — when cols/rows are 0 (falsy)
    vi.mocked(spawn).mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);
    vi.mocked(invoke).mockResolvedValue("/bin/zsh");

    const zeroTerm = { cols: 0, rows: 0, write: vi.fn() } as unknown as import("@xterm/xterm").Terminal;

    await spawnPty({ term: zeroTerm, onExit: vi.fn(), disposed: () => false });

    const spawnArgs = vi.mocked(spawn).mock.calls[0][2] as { cols: number; rows: number };
    expect(spawnArgs.cols).toBe(80);
    expect(spawnArgs.rows).toBe(24);
  });

  it("injects login shell PATH into PTY environment", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_default_shell") return Promise.resolve("/bin/zsh");
      if (cmd === "get_login_shell_path") return Promise.resolve("/usr/local/bin:/usr/bin:/bin");
      return Promise.resolve(null);
    });

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    expect(invoke).toHaveBeenCalledWith("get_login_shell_path");
    const spawnCallEnv = vi.mocked(spawn).mock.calls[0][2] as { env: Record<string, string> };
    expect(spawnCallEnv.env.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
  });

  it("falls back to default PATH when get_login_shell_path IPC fails", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_login_shell_path") return Promise.reject(new Error("IPC error"));
      if (cmd === "get_default_shell") return Promise.resolve("/bin/zsh");
      return Promise.resolve(null);
    });

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    const spawnCallEnv = vi.mocked(spawn).mock.calls[0][2] as { env: Record<string, string> };
    expect(spawnCallEnv.env.PATH).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("falls back to default PATH when get_login_shell_path returns empty", async () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "" },
    } as ReturnType<typeof useSettingsStore.getState>);
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_login_shell_path") return Promise.resolve("");
      if (cmd === "get_default_shell") return Promise.resolve("/bin/zsh");
      return Promise.resolve(null);
    });

    await spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: () => false });

    const spawnCallEnv = vi.mocked(spawn).mock.calls[0][2] as { env: Record<string, string> };
    expect(spawnCallEnv.env.PATH).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("throws 'disposed before fallback spawn' when disposed becomes true after fallback shell resolved (L168)", async () => {
    // L168: disposed() check AFTER the fallback invoke resolves
    // Need: disposed() returns false at L143 (pre-spawn check) but true at L168 (post-fallback-await)
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      terminal: { shell: "/usr/bin/nonexistent" },
    } as ReturnType<typeof useSettingsStore.getState>);

    let callCount = 0;
    const disposedFn = () => {
      callCount++;
      // First call (L143 check before spawn): not disposed
      // Second call (L168 check after fallback await): disposed
      return callCount >= 2;
    };

    // First spawn (configured shell) throws; second spawn never reached because disposed
    vi.mocked(spawn).mockImplementation((() => {
      throw new Error("spawn failed");
    }) as unknown as typeof spawn);

    await expect(
      spawnPty({ term: mockTerm, onExit: vi.fn(), disposed: disposedFn }),
    ).rejects.toThrow("disposed before fallback spawn");
  });
});
