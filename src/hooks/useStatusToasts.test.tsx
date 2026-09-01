// WI-UB3 — re-audit 20260901: rare status-bar states (update, auto-save
// paused, divergent) relocate to transient toasts; the bar keeps only its
// always-relevant chrome. The toast DECISION is a pure function tested
// exhaustively; the hooks are thin effects over it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const sonner = vi.hoisted(() => {
  const base = vi.fn();
  return Object.assign(base, {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  });
});

// sonner is the EXTERNAL boundary — the ime wrapper, the stores and the
// hooks all run real, so this suite cannot pass against a wiring mock.
vi.mock("sonner", () => ({ toast: sonner }));

import { useMcpStore } from "@/stores/mcpStore";
import {
  updateToastDescriptor,
  useSaveStateToasts,
  useUpdateToasts,
} from "./useStatusToasts";

function setUpdate(patch: Record<string, unknown>) {
  act(() => {
    useMcpStore.setState((s) => ({ update: { ...s.update, ...patch } }) as never);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setUpdate({ status: "idle", updateInfo: null });
});

describe("updateToastDescriptor (pure)", () => {
  it.each(["idle", "up-to-date", "checking", "downloading", "installing"] as const)(
    "%s is silent — transient states never toast",
    (status) => {
      expect(updateToastDescriptor(status, "idle", false, false, null)).toBeNull();
    },
  );

  it("available toasts an info with the View action — unless auto-download will consume it", () => {
    expect(updateToastDescriptor("available", "checking", false, false, "1.2.3")).toMatchObject({
      kind: "info",
      action: "view",
    });
    expect(updateToastDescriptor("available", "checking", false, true, "1.2.3")).toBeNull();
  });

  it("ready is a STICKY success with the Restart action", () => {
    expect(updateToastDescriptor("ready", "installing", false, false, "1.2.3")).toMatchObject({
      kind: "success",
      action: "restart",
      sticky: true,
    });
  });

  it("a TRANSFER error (download/install died) is a sticky error with Retry", () => {
    for (const prev of ["downloading", "installing"] as const) {
      expect(updateToastDescriptor("error", prev, false, false, null)).toMatchObject({
        kind: "error",
        action: "retry",
        sticky: true,
      });
    }
  });

  it("a CHECK error stays silent here — useUpdateChecker owns check-flow feedback (manual errors with the real message; background flaps deliberately quiet)", () => {
    expect(updateToastDescriptor("error", "checking", false, false, null)).toBeNull();
    expect(updateToastDescriptor("error", "idle", false, false, null)).toBeNull();
  });

  it("a stalled flow outranks every status — the toast is the only recovery affordance left", () => {
    for (const status of ["checking", "downloading", "installing", "error"] as const) {
      expect(updateToastDescriptor(status, "checking", true, false, null)).toMatchObject({
        kind: "warning",
        action: "recover",
        sticky: true,
      });
    }
  });
});

describe("useUpdateToasts", () => {
  it("fires the ready toast once with the version, sticky, under the shared id", async () => {
    renderHook(() => useUpdateToasts());
    setUpdate({ status: "ready", updateInfo: { version: "9.9.9" } });
    await act(async () => {});
    expect(sonner.success).toHaveBeenCalledTimes(1);
    const [message, opts] = sonner.success.mock.calls[0]!;
    expect(String(message)).toContain("9.9.9");
    expect(opts).toMatchObject({ id: "status-update", duration: Infinity });
    expect(opts.action.label).toBeTruthy();
  });

  it("dismisses the shared toast when the state goes silent again", async () => {
    renderHook(() => useUpdateToasts());
    setUpdate({ status: "downloading" });
    await act(async () => {});
    setUpdate({ status: "error" });
    await act(async () => {});
    expect(sonner.error).toHaveBeenCalledTimes(1);
    setUpdate({ status: "checking" });
    await act(async () => {});
    expect(sonner.dismiss).toHaveBeenCalledWith("status-update");
  });

  it("stays quiet on a background CHECK error — that story belongs to useUpdateChecker", async () => {
    renderHook(() => useUpdateToasts());
    setUpdate({ status: "checking" });
    await act(async () => {});
    setUpdate({ status: "error" });
    await act(async () => {});
    expect(sonner.error).not.toHaveBeenCalled();
  });
});

describe("useSaveStateToasts", () => {
  it("rising paused edge raises a sticky warning; falling edge dismisses it", async () => {
    const { rerender } = renderHook(
      ({ paused }) => useSaveStateToasts(paused, false, "Mod-s"),
      { initialProps: { paused: false } },
    );
    expect(sonner.warning).not.toHaveBeenCalled();

    rerender({ paused: true });
    await act(async () => {});
    expect(sonner.warning).toHaveBeenCalledTimes(1);
    const [message, opts] = sonner.warning.mock.calls[0]!;
    expect(String(message)).toContain("Auto-save paused");
    // The shortcut is formatted for the platform, never the raw chord.
    expect(String(message)).not.toContain("Mod-s");
    expect(opts).toMatchObject({ id: "status-autosave-paused", duration: Infinity });

    rerender({ paused: false });
    await act(async () => {});
    expect(sonner.dismiss).toHaveBeenCalledWith("status-autosave-paused");
  });

  it("divergent raises its own sticky warning — but stays quiet while paused owns the story", async () => {
    const { rerender } = renderHook(
      ({ paused, divergent }) => useSaveStateToasts(paused, divergent, "Mod-s"),
      { initialProps: { paused: true, divergent: true } },
    );
    await act(async () => {});
    // Paused takes priority (same rule the old inline badges had).
    const divergentCalls = sonner.warning.mock.calls.filter(
      (c) => (c[1] as { id?: string } | undefined)?.id === "status-divergent",
    );
    expect(divergentCalls).toHaveLength(0);

    rerender({ paused: false, divergent: true });
    await act(async () => {});
    expect(
      sonner.warning.mock.calls.some(
        (c) => (c[1] as { id?: string } | undefined)?.id === "status-divergent",
      ),
    ).toBe(true);

    rerender({ paused: false, divergent: false });
    await act(async () => {});
    expect(sonner.dismiss).toHaveBeenCalledWith("status-divergent");
  });
});
