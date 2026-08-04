// WI-19 — the engine flag has to REACH Rust.
//
// Settings live in the webview's localStorage, so the Rust runner cannot read
// them; before this, `run_workflow` executed whatever YAML arrived regardless
// of the flag. Rust now starts fail-closed and this service is what opens the
// gate — which means a missing initial push is indistinguishable from the
// feature being off, and a missing unsubscribe leaves the runner armed after
// the user switches it back off.
//
// Real settings store; only the Tauri `invoke` boundary is faked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  warn: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));
vi.mock("@/utils/debug", () => ({
  workflowWarn: (...args: unknown[]) => mocks.warn(...args),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

import { startWorkflowEnginePolicySync as startSync } from "./workflowEnginePolicySync";
import { useSettingsStore } from "@/stores/settingsStore";

function setEngine(enabled: boolean) {
  useSettingsStore.getState().updateAdvancedSetting("workflowEngine", enabled);
}

/**
 * Start a sync and register its cleanup. A test that fails before its own
 * `stop()` used to leak the subscription into every later test in the file,
 * turning one failure into five.
 */
const started: Array<() => void> = [];
function startWorkflowEnginePolicySync(): () => void {
  const stop = startSync();
  started.push(stop);
  return stop;
}

beforeEach(() => {
  setEngine(false);
  useSettingsStore.getState().updateAdvancedSetting("workflowViewer", false);
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.warn.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => {
  for (const stop of started.splice(0)) stop();
});

/** Every `workflow_engine_policy` push, in order. */
function pushes(): boolean[] {
  return mocks.invoke.mock.calls
    .filter((c) => c[0] === "workflow_engine_policy")
    .map((c) => (c[1] as { enabled: boolean }).enabled);
}

/** Let the serialized queue and its backoff timers drain. */
async function drain(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await vi.advanceTimersByTimeAsync(1000);
  }
}

describe("startWorkflowEnginePolicySync", () => {
  it("pushes the current flag immediately, even when it is off", () => {
    // Rust already defaults to off, but pushing anyway is what makes the
    // service's contract "Rust matches the store", not "Rust matches the store
    // except at startup".
    const stop = startWorkflowEnginePolicySync();
    expect(mocks.invoke).toHaveBeenCalledWith("workflow_engine_policy", {
      enabled: false,
    });
    stop();
  });

  it("pushes enabled=true at bootstrap for a user who already opted in", () => {
    setEngine(true);
    const stop = startWorkflowEnginePolicySync();
    expect(mocks.invoke).toHaveBeenCalledWith("workflow_engine_policy", {
      enabled: true,
    });
    stop();
  });

  it("pushes both directions when the setting changes", async () => {
    const stop = startWorkflowEnginePolicySync();
    mocks.invoke.mockClear();

    setEngine(true);
    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("workflow_engine_policy", {
        enabled: true,
      });
    });

    mocks.invoke.mockClear();
    setEngine(false);
    // Awaited, not synchronous: pushes are SERIALIZED since audit
    // 20260804-F11, so a change made while the previous push is still in
    // flight is delivered after it — which is the point, since two
    // fire-and-forget pushes could otherwise land in either order and leave
    // Rust on the wrong setting.
    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("workflow_engine_policy", {
        enabled: false,
      });
    });
    stop();
  });

  it("does not push for unrelated settings changes", () => {
    const stop = startWorkflowEnginePolicySync();
    mocks.invoke.mockClear();
    useSettingsStore.getState().updateAdvancedSetting("workflowViewer", true);
    useSettingsStore.getState().updateAdvancedSetting("developerMode", true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    stop();
    useSettingsStore.getState().updateAdvancedSetting("developerMode", false);
  });

  it("stops pushing after cleanup — a stale subscription outlives the window", () => {
    const stop = startWorkflowEnginePolicySync();
    stop();
    mocks.invoke.mockClear();
    setEngine(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("warns instead of throwing when the push fails — Rust stays fail-closed", async () => {
    mocks.invoke.mockRejectedValue(new Error("ipc down"));
    const stop = startWorkflowEnginePolicySync();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.warn).toHaveBeenCalled();
    stop();
  });
});

/**
 * Audit 20260804-F11 — the two directions do not fail alike.
 *
 * Both pushes used to be one fire-and-forget `void invoke().catch(warn)`. A
 * failed ENABLE is harmless (Rust stays closed, the feature is unavailable).
 * A failed DISABLE is the security posture inverted: the user switched the
 * engine off, Rust never heard it, and the runner stays armed for the rest of
 * the session — recorded only in a log file nobody reads.
 */
describe("a rejected DISABLE never fails open silently", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries the disable, and stops as soon as one succeeds", async () => {
    const stop = startWorkflowEnginePolicySync();
    setEngine(true);
    await drain();
    mocks.invoke.mockReset();

    // Two rejections, then success.
    mocks.invoke
      .mockRejectedValueOnce(new Error("ipc down"))
      .mockRejectedValueOnce(new Error("ipc down"))
      .mockResolvedValue(undefined);
    setEngine(false);
    await drain();

    expect(pushes()).toEqual([false, false, false]);
    expect(mocks.toastError).not.toHaveBeenCalled();
    stop();
  });

  it("surfaces a toast when every disable attempt fails", async () => {
    const stop = startWorkflowEnginePolicySync();
    setEngine(true);
    await drain();
    mocks.invoke.mockReset().mockRejectedValue(new Error("ipc down"));

    setEngine(false);
    await drain();

    expect(pushes()).toEqual([false, false, false]);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    // A message, not a key echo — the user has to be able to act on it.
    expect(String(mocks.toastError.mock.calls[0][0])).toMatch(/workflow engine/i);
    stop();
  });

  it("does NOT retry a failed enable — that direction fails closed", async () => {
    mocks.invoke.mockReset().mockRejectedValue(new Error("ipc down"));
    const stop = startWorkflowEnginePolicySync();
    await drain();
    mocks.invoke.mockClear();

    setEngine(true);
    await drain();

    expect(pushes()).toEqual([true]);
    expect(mocks.toastError).not.toHaveBeenCalled();
    stop();
  });

  it("abandons a stale disable retry when the user re-enables mid-retry", async () => {
    // Completing the retry would undo a change the user has already made.
    const stop = startWorkflowEnginePolicySync();
    mocks.invoke.mockReset().mockRejectedValue(new Error("ipc down"));

    setEngine(true);
    setEngine(false);
    setEngine(true);
    await drain();

    // Whatever was attempted, the LAST push reflects the final desired state,
    // and no stale `false` lands after it.
    const seen = pushes();
    expect(seen.at(-1)).toBe(true);
    expect(mocks.toastError).not.toHaveBeenCalled();
    stop();
  });

  it("serializes pushes so the last change is the last write", async () => {
    const stop = startWorkflowEnginePolicySync();
    await drain();
    mocks.invoke.mockClear();

    setEngine(true);
    setEngine(false);
    setEngine(true);
    await drain();

    expect(pushes().at(-1)).toBe(true);
    stop();
  });

  it("stops retrying after cleanup — a stale retry outlives the window", async () => {
    const stop = startWorkflowEnginePolicySync();
    setEngine(true);
    await drain();
    mocks.invoke.mockReset().mockRejectedValue(new Error("ipc down"));

    setEngine(false);
    stop();
    await drain();

    // At most the in-flight attempt; no further retries, and no toast for a
    // window that is going away.
    expect(pushes().length).toBeLessThanOrEqual(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
