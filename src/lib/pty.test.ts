// Regression test for #974 — VMarkPty.kill() leaked the Rust session map entry
// because _cleanup() removes the pty:exit listener BEFORE pty_kill, so the
// exit handler that calls pty_close never runs. kill() must call pty_close
// itself (after pty_kill), and the setup-time guard path must too.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("@/utils/debug", () => ({ ptyWarn: vi.fn(), terminalLog: vi.fn() }));

// The global test setup (src/test/setup.ts) mocks the whole @/lib/pty module
// for Terminal component tests. This suite exercises the REAL implementation,
// so unmock it here (the Tauri core/event mocks above still apply).
vi.unmock("@/lib/pty");

import { spawn } from "@/lib/pty";

const PID = 4242;

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  invokeMock.mockImplementation((cmd: string) =>
    cmd === "pty_spawn" ? Promise.resolve(PID) : Promise.resolve(undefined),
  );
  // listen() resolves to an unlisten fn
  listenMock.mockResolvedValue(() => {});
});

describe("VMarkPty.kill() — #974 session leak", () => {
  it("calls pty_close after pty_kill so the Rust session is freed", async () => {
    const pty = spawn("bash", []);
    // Wait for setup to finish (reader started = ready).
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("pty_start", { pid: PID });
    });

    pty.kill();

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("pty_close", { pid: PID });
    });
    expect(invokeMock).toHaveBeenCalledWith("pty_kill", { pid: PID });
    // Exactly once on the normal path (the eagerly-removed exit listener can't
    // double-close).
    const closeCalls = invokeMock.mock.calls.filter((c) => c[0] === "pty_close");
    expect(closeCalls).toHaveLength(1);
  });

  it("frees the session even when kill() races setup (setup-guard path)", async () => {
    const pty = spawn("bash", []);
    pty.kill(); // before _ready resolves → hits the setup guard

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("pty_close", { pid: PID });
    });
    expect(invokeMock).toHaveBeenCalledWith("pty_kill", { pid: PID });
    // Guard aborts before phase 3 — the reader never starts.
    expect(invokeMock).not.toHaveBeenCalledWith("pty_start", { pid: PID });
  });
});
