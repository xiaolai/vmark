/**
 * Tests for the custom PTY wrapper (replacement for tauri-pty).
 * Verifies spawn lifecycle, event wiring, flow control, and cleanup.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Undo the global mock from setup.ts so we test the real implementation
vi.unmock("@/lib/pty");

// Mock Tauri APIs before importing the module under test
const mockInvoke = vi.fn();
const mockListen = vi.fn();
const mockUnlisten = vi.fn();

// Minimal stand-in for @tauri-apps/api/core Channel: holds the onmessage
// callback so tests can drive PTY output through it (WI-1.1 binary transport).
// vi.hoisted so the class exists before the hoisted vi.mock factory runs.
const { MockChannel } = vi.hoisted(() => {
  class MockChannel {
    onmessage: ((msg: unknown) => void) | null = null;
  }
  return { MockChannel };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: MockChannel,
}));

type DataChannel = { onmessage: ((msg: unknown) => void) | null };
/** Pull the Channel passed to pty_start out of the recorded invoke calls. */
function getDataChannel(): DataChannel {
  const call = mockInvoke.mock.calls.find((c) => c[0] === "pty_start");
  return (call?.[1] as { onBytes: DataChannel }).onBytes;
}

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import { spawn, type IPty } from "../pty";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("spawn", () => {
  it("returns an IPty object immediately (sync)", () => {
    mockInvoke.mockResolvedValue(42);
    mockListen.mockResolvedValue(mockUnlisten);

    const pty = spawn("/bin/sh", []);
    expect(pty).toBeDefined();
    expect(pty.onData).toBeTypeOf("function");
    expect(pty.onExit).toBeTypeOf("function");
    expect(pty.write).toBeTypeOf("function");
    expect(pty.resize).toBeTypeOf("function");
    expect(pty.kill).toBeTypeOf("function");
    expect(pty.pause).toBeTypeOf("function");
    expect(pty.resume).toBeTypeOf("function");
  });

  it("calls pty_spawn then registers listeners then pty_start", async () => {
    const calls: string[] = [];
    mockInvoke.mockImplementation((cmd: string) => {
      calls.push(cmd);
      if (cmd === "pty_spawn") return Promise.resolve(7);
      return Promise.resolve();
    });
    mockListen.mockImplementation((_event: string) => {
      calls.push(`listen:${_event}`);
      return Promise.resolve(mockUnlisten);
    });

    const pty = spawn("/bin/zsh", [], { cols: 120, rows: 40, cwd: "/tmp" });
    // Wait for internal _ready to resolve
    await vi.waitFor(() => {
      expect(calls).toContain("pty_start");
    });

    expect(pty.pid).toBe(7);
    // Order: spawn → listen exit → start. Output is a binary Channel passed
    // INTO pty_start (no pty:data event listener), wired before the reader
    // starts, so there is no data-loss race (WI-1.1).
    expect(calls[0]).toBe("pty_spawn");
    expect(calls[1]).toBe("listen:pty:exit:7");
    expect(calls[2]).toBe("pty_start");
    expect(calls).not.toContain("listen:pty:data:7");
    // pty_start receives the data Channel as `onBytes`.
    const startCall = mockInvoke.mock.calls.find((c) => c[0] === "pty_start");
    expect(startCall?.[1]).toMatchObject({ pid: 7 });
    expect((startCall?.[1] as { onBytes: unknown }).onBytes).toBeInstanceOf(MockChannel);
  });

  it("passes spawn options correctly", async () => {
    mockInvoke.mockResolvedValue(1);
    mockListen.mockResolvedValue(mockUnlisten);

    spawn("/bin/bash", ["-l"], { cols: 100, rows: 30, cwd: "/home", env: { FOO: "bar" } });

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", {
        file: "/bin/bash",
        args: ["-l"],
        cols: 100,
        rows: 30,
        cwd: "/home",
        env: { FOO: "bar" },
      });
    });
  });
});

describe("onData", () => {
  it("fires listeners with a Uint8Array when the channel delivers bytes", async () => {
    mockInvoke.mockResolvedValue(1);
    mockListen.mockResolvedValue(mockUnlisten);

    const pty = spawn("/bin/sh", []);
    const received: unknown[] = [];
    pty.onData((data) => received.push(data));

    // Wait until pty_start has run so the data channel exists.
    await vi.waitFor(() => expect(getDataChannel()).toBeInstanceOf(MockChannel));

    // The Rust side sends Raw bytes → the JS Channel delivers an ArrayBuffer.
    const buf = new Uint8Array([104, 101, 108, 108, 111]).buffer;
    getDataChannel().onmessage!(buf);

    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(received[0] as Uint8Array)).toEqual([104, 101, 108, 108, 111]);
  });

  it("passes through a Uint8Array unchanged if the channel delivers one", async () => {
    mockInvoke.mockResolvedValue(1);
    mockListen.mockResolvedValue(mockUnlisten);

    const pty = spawn("/bin/sh", []);
    const received: unknown[] = [];
    pty.onData((data) => received.push(data));

    await vi.waitFor(() => expect(getDataChannel()).toBeInstanceOf(MockChannel));

    getDataChannel().onmessage!(new Uint8Array([1, 2, 3]));
    expect(received[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(received[0] as Uint8Array)).toEqual([1, 2, 3]);
  });
});

describe("onExit", () => {
  it("fires exit event, cleans up listeners, and closes session", async () => {
    let exitHandler: ((event: { payload: { exit_code: number } }) => void) | null = null;
    mockInvoke.mockResolvedValue(1);
    mockListen.mockImplementation((event: string, handler: (e: unknown) => void) => {
      if (event.startsWith("pty:exit:")) exitHandler = handler;
      return Promise.resolve(mockUnlisten);
    });

    const pty = spawn("/bin/sh", []);
    const exits: unknown[] = [];
    pty.onExit((e) => exits.push(e));

    await vi.waitFor(() => expect(exitHandler).not.toBeNull());

    exitHandler!({ payload: { exit_code: 0 } });
    expect(exits).toEqual([{ exitCode: 0 }]);
    // Only the exit listener needs unlistening now — output is a Channel (no
    // unlisten); WI-1.1 clears its onmessage instead.
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
    // pty_close should be called to free Rust-side session
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_close", { pid: 1 });
    });
  });
});

describe("write / resize / kill / pause / resume", () => {
  let pty: IPty;

  beforeEach(async () => {
    mockInvoke.mockResolvedValue(5);
    mockListen.mockResolvedValue(mockUnlisten);
    pty = spawn("/bin/sh", []);
    await vi.waitFor(() => expect(pty.pid).toBe(5));
  });

  it("write invokes pty_write", async () => {
    pty.write("ls\n");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_write", { pid: 5, data: "ls\n" });
    });
  });

  it("resize invokes pty_resize and updates cols/rows", async () => {
    pty.resize(200, 50);
    expect(pty.cols).toBe(200);
    expect(pty.rows).toBe(50);
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_resize", { pid: 5, cols: 200, rows: 50 });
    });
  });

  it("kill invokes pty_kill and cleans up listeners", async () => {
    pty.kill();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_kill", { pid: 5 });
    });
    // Exit listener cleaned up eagerly on kill (data channel has no unlisten).
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it("pause invokes pty_pause", async () => {
    pty.pause();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_pause", { pid: 5 });
    });
  });

  it("resume invokes pty_resume", async () => {
    pty.resume();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_resume", { pid: 5 });
    });
  });
});

describe("error resilience", () => {
  it("does not throw unhandled rejection when spawn fails", async () => {
    mockInvoke.mockRejectedValue(new Error("spawn failed"));
    mockListen.mockResolvedValue(mockUnlisten);

    const pty = spawn("/no/such/shell", []);
    // Calling write after a failed spawn should not throw
    expect(() => pty.write("ls")).not.toThrow();
    // Let promises settle
    await new Promise((r) => setTimeout(r, 50));
  });

  it("pid is 0 before ready resolves", () => {
    mockInvoke.mockResolvedValue(99);
    mockListen.mockResolvedValue(mockUnlisten);
    const pty = spawn("/bin/sh", []);
    // pid is not yet resolved synchronously
    expect(pty.pid).toBe(0);
  });
});

describe("error logging", () => {
  let pty: IPty;

  beforeEach(async () => {
    mockInvoke.mockResolvedValue(5);
    mockListen.mockResolvedValue(mockUnlisten);
    pty = spawn("/bin/sh", []);
    await vi.waitFor(() => expect(pty.pid).toBe(5));
    vi.clearAllMocks();
  });

  it("logs warning when pty_write fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("session closed"));

    pty.write("data");
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[PTY]", "pty_write failed:", "session closed");
    });
    warnSpy.mockRestore();
  });

  it("logs warning when pty_resize fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("invalid dimensions"));

    pty.resize(0, 0);
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[PTY]", "pty_resize failed:", "invalid dimensions");
    });
    warnSpy.mockRestore();
  });

  it("logs debug when pty_kill fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("already dead"));

    pty.kill();
    await vi.waitFor(() => {
      expect(logSpy).toHaveBeenCalledWith("[Terminal]", "pty_kill failed:", "already dead");
    });
    logSpy.mockRestore();
  });

  it("logs debug when pty_pause fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("not running"));

    pty.pause();
    await vi.waitFor(() => {
      expect(logSpy).toHaveBeenCalledWith("[Terminal]", "pty_pause failed:", "not running");
    });
    logSpy.mockRestore();
  });

  it("logs debug when pty_resume fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("not paused"));

    pty.resume();
    await vi.waitFor(() => {
      expect(logSpy).toHaveBeenCalledWith("[Terminal]", "pty_resume failed:", "not paused");
    });
    logSpy.mockRestore();
  });

  it("handles non-Error rejection values", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce("string error");

    pty.write("data");
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[PTY]", "pty_write failed:", "string error");
    });
    warnSpy.mockRestore();
  });
});

describe("string args coercion", () => {
  it("accepts a single string arg and wraps it in array", async () => {
    mockInvoke.mockResolvedValue(1);
    mockListen.mockResolvedValue(mockUnlisten);

    spawn("/bin/sh", "-c" as unknown as string[]);

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", expect.objectContaining({
        args: ["-c"],
      }));
    });
  });
});
