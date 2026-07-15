/**
 * HotExitDevTools — capture / inspect / restore / clear / restart paths.
 *
 * Regression coverage for two defects found in the 20260713 audit:
 *   1. A *failed* invoke and a *successful* `null` session were both reported
 *      as "no session" (withErrorHandling collapsed them to null).
 *   2. A rejected restart never cleared the busy flag, permanently disabling
 *      every button in the group.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  restartWithHotExit: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: mocks.toast }));
vi.mock("@/services/persistence/hotExit/restartWithHotExit", () => ({
  restartWithHotExit: mocks.restartWithHotExit,
}));

import { HotExitDevTools } from "./HotExitDevTools";
import type { SessionData } from "@/services/persistence/hotExit/types";

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    timestamp: Math.floor(Date.now() / 1000),
    vmark_version: "0.9.0",
    windows: [{ window_label: "main", is_main_window: true }],
    ...overrides,
  } as SessionData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HotExitDevTools — capture", () => {
  it("reports the captured window count on success", async () => {
    mocks.invoke.mockResolvedValue(
      session({
        windows: [
          { window_label: "main", is_main_window: true },
          { window_label: "w2", is_main_window: false },
        ] as never,
      })
    );
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Test Capture" }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(mocks.invoke).toHaveBeenCalledWith("hot_exit_capture");
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Captured 2 window(s)",
      { description: "v0.9.0" }
    );
  });

  it("reports an error toast — and nothing else — when the command rejects", async () => {
    mocks.invoke.mockRejectedValue(new Error("disk full"));
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Test Capture" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(mocks.toast.error).toHaveBeenCalledWith("Capture failed", {
      description: "disk full",
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

describe("HotExitDevTools — inspect", () => {
  it("describes the session when one exists", async () => {
    mocks.invoke.mockResolvedValue(session());
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Inspect Session" }));

    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalled());
    expect(mocks.toast.info).toHaveBeenCalledWith(
      expect.stringContaining("Session found"),
      { description: "1 windows, v0.9.0" }
    );
  });

  it("reports 'no session' when the command succeeds with null", async () => {
    mocks.invoke.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Inspect Session" }));

    await waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith("No saved session found")
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("does NOT report 'no session' when the command rejects (audit 20260713)", async () => {
    mocks.invoke.mockRejectedValue(new Error("ipc down"));
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Inspect Session" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    // The failure must not masquerade as an empty-but-healthy session.
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });
});

describe("HotExitDevTools — restore", () => {
  it("dispatches the multi-window command for a multi-window session (#970)", async () => {
    const multi = session({
      windows: [
        { window_label: "main", is_main_window: true },
        { window_label: "vmark-2", is_main_window: false },
      ] as never,
    });
    mocks.invoke.mockImplementation((cmd: string) =>
      cmd === "hot_exit_inspect_session" ? Promise.resolve(multi) : Promise.resolve(undefined)
    );
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Test Restore" }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Session restored successfully"));
    const restoreCall = mocks.invoke.mock.calls.find(([cmd]) => cmd !== "hot_exit_inspect_session");
    expect(restoreCall?.[0]).toBe("hot_exit_restore_multi_window");
    expect(restoreCall?.[1]).toEqual({ session: multi });
  });

  it("reports 'nothing to restore' when no session is saved", async () => {
    mocks.invoke.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Test Restore" }));

    await waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith("No saved session to restore")
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not claim success when the restore command itself rejects", async () => {
    mocks.invoke.mockImplementation((cmd: string) =>
      cmd === "hot_exit_inspect_session"
        ? Promise.resolve(session())
        : Promise.reject(new Error("restore boom"))
    );
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Test Restore" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Restore failed", {
      description: "restore boom",
    }));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

describe("HotExitDevTools — clear", () => {
  it("confirms once the session is cleared", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Clear Session" }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Session cleared"));
    expect(mocks.invoke).toHaveBeenCalledWith("hot_exit_clear_session");
  });

  it("stays silent about success when clearing fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("locked"));
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Clear Session" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

describe("HotExitDevTools — busy state", () => {
  it("re-enables every action after a failed restart (audit 20260713)", async () => {
    mocks.restartWithHotExit.mockRejectedValue(new Error("relaunch denied"));
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    const restart = screen.getByRole("button", { name: "Test Restart" });
    await user.click(restart);

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Restart failed", {
      description: "relaunch denied",
    }));
    // The busy flag must be cleared in `finally`, or the group stays dead.
    await waitFor(() => expect(restart).not.toBeDisabled());
    expect(screen.getByRole("button", { name: "Clear Session" })).not.toBeDisabled();
  });

  it("disables the actions while one is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    render(<HotExitDevTools />);

    await user.click(screen.getByRole("button", { name: "Test Capture" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Inspect Session" })).toBeDisabled()
    );

    release(session());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Inspect Session" })).not.toBeDisabled()
    );
  });
});
