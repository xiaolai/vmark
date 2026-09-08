import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

// --- Hoisted mocks (must be created before vi.mock factories run) ---

const { mockInvoke, mockRefresh, mcpServerState } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockRefresh: vi.fn(),
  mcpServerState: { running: false, port: null as number | null },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/hooks/useMcpServer", () => ({
  useMcpServer: () => ({
    running: mcpServerState.running,
    port: mcpServerState.port,
    refresh: mockRefresh,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// --- Imports (after mocks) ---

import { latestBridgeStatus, useMcpHealthCheck } from "../useMcpHealthCheck";
import { useMcpStore } from "@/stores/mcpStore";

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  useMcpStore.getState().resetHealth();
  mcpServerState.running = false;
  mcpServerState.port = null;
});

// --- Tests ---

describe("useMcpHealthCheck — sidecar ok + bridge running", () => {
  it("returns success result and writes health to store with no error", async () => {
    mockRefresh.mockResolvedValue({ running: true, port: 12345 });
    mockInvoke.mockResolvedValue({
      status: "ok",
      version: "0.4.0",
      toolCount: 7,
      resourceCount: 2,
      tools: ["doc.read", "doc.write"],
    });

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(mockInvoke).toHaveBeenCalledWith("mcp_sidecar_health");
    expect(healthResult.success).toBe(true);
    expect(healthResult.error).toBeUndefined();
    expect(healthResult.version).toBe("0.4.0");
    expect(healthResult.toolCount).toBe(7);
    expect(healthResult.resourceCount).toBe(2);
    expect(healthResult.bridgeRunning).toBe(true);
    expect(healthResult.bridgePort).toBe(12345);

    const stored = useMcpStore.getState().health.health;
    expect(stored.version).toBe("0.4.0");
    expect(stored.toolCount).toBe(7);
    expect(stored.resourceCount).toBe(2);
    expect(stored.tools).toEqual(["doc.read", "doc.write"]);
    expect(stored.checkError).toBeNull();
    expect(stored.lastChecked).toBeInstanceOf(Date);
  });
});

describe("useMcpHealthCheck — sidecar ok + bridge not running", () => {
  it("returns success:false with bridgeNotRunning error and stores it", async () => {
    mockRefresh.mockResolvedValue({ running: false, port: null });
    mockInvoke.mockResolvedValue({
      status: "ok",
      version: "0.4.0",
      toolCount: 4,
      resourceCount: 1,
      tools: ["doc.read"],
    });

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(healthResult.success).toBe(false);
    expect(healthResult.error).toBe("mcp.bridgeNotRunning");
    expect(healthResult.version).toBe("0.4.0");
    expect(healthResult.toolCount).toBe(4);
    expect(healthResult.bridgeRunning).toBe(false);
    expect(healthResult.bridgePort).toBeNull();

    const stored = useMcpStore.getState().health.health;
    expect(stored.checkError).toBe("mcp.bridgeNotRunning");
    expect(stored.version).toBe("0.4.0");
    expect(stored.toolCount).toBe(4);
  });
});

describe("useMcpHealthCheck — sidecar reports error", () => {
  it("returns failure with sidecar-provided error and persists it", async () => {
    mockRefresh.mockResolvedValue({ running: true, port: 9999 });
    mockInvoke.mockResolvedValue({
      status: "error",
      error: "boom",
      version: "0.4.0",
      toolCount: 0,
      resourceCount: 0,
      tools: [],
    });

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(healthResult.success).toBe(false);
    expect(healthResult.error).toBe("boom");
    expect(healthResult.version).toBe("0.4.0");
    expect(healthResult.toolCount).toBe(0);
    expect(healthResult.resourceCount).toBe(0);
    expect(healthResult.bridgeRunning).toBe(true);
    expect(healthResult.bridgePort).toBe(9999);

    const stored = useMcpStore.getState().health.health;
    expect(stored.checkError).toBe("boom");
    expect(stored.version).toBe("0.4.0");
    expect(stored.tools).toEqual([]);
  });

  it("falls back to translated healthCheckFailed key when sidecar omits error message", async () => {
    mockRefresh.mockResolvedValue({ running: true, port: 9999 });
    mockInvoke.mockResolvedValue({
      status: "error",
      version: "0.4.0",
      toolCount: 0,
      resourceCount: 0,
      tools: [],
    });

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(healthResult.error).toBe("mcp.healthCheckFailed");
    expect(useMcpStore.getState().health.health.checkError).toBe(
      "mcp.healthCheckFailed",
    );
  });
});

describe("useMcpHealthCheck — invoke throws", () => {
  it("preserves existing store values in result and only updates lastChecked + checkError", async () => {
    mockRefresh.mockResolvedValue({ running: true, port: 4242 });
    mcpServerState.running = true;
    mcpServerState.port = 4242;

    // Seed the store so the catch path has values to read via getState()
    useMcpStore.setState((s) => ({
      health: {
        ...s.health,
        health: {
          version: "0.3.0",
          toolCount: 5,
          resourceCount: 3,
          tools: ["doc.read", "doc.write", "doc.list"],
          lastChecked: new Date("2026-01-01T00:00:00Z"),
          checkError: null,
        },
      },
    }));

    mockInvoke.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(healthResult.success).toBe(false);
    expect(healthResult.error).toBe("offline");
    expect(healthResult.version).toBe("0.3.0");
    expect(healthResult.toolCount).toBe(5);
    expect(healthResult.resourceCount).toBe(3);
    expect(healthResult.bridgeRunning).toBe(true);
    expect(healthResult.bridgePort).toBe(4242);

    const stored = useMcpStore.getState().health.health;
    // Catch path must NOT overwrite version/toolCount/resourceCount/tools
    expect(stored.version).toBe("0.3.0");
    expect(stored.toolCount).toBe(5);
    expect(stored.resourceCount).toBe(3);
    expect(stored.tools).toEqual(["doc.read", "doc.write", "doc.list"]);
    expect(stored.checkError).toBe("offline");
    expect(stored.lastChecked).toBeInstanceOf(Date);
    expect(stored.lastChecked?.toISOString()).not.toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("uses fallback values when store has no prior health data", async () => {
    mockRefresh.mockResolvedValue({ running: false, port: null });
    mockInvoke.mockRejectedValue("string error");

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(healthResult.error).toBe("string error");
    expect(healthResult.version).toBe("unknown");
    expect(healthResult.toolCount).toBe(0);
    expect(healthResult.resourceCount).toBe(0);
  });
});

describe("useMcpHealthCheck — isChecking lifecycle", () => {
  it("toggles isChecking true during the call and false after success", async () => {
    let observedDuringCall = false;

    mockRefresh.mockResolvedValue({ running: true, port: 1 });
    mockInvoke.mockImplementation(async () => {
      observedDuringCall = useMcpStore.getState().health.isChecking;
      return {
        status: "ok",
        version: "0.4.0",
        toolCount: 1,
        resourceCount: 0,
        tools: [],
      };
    });

    const { result } = renderHook(() => useMcpHealthCheck());

    expect(useMcpStore.getState().health.isChecking).toBe(false);

    await act(async () => {
      await result.current.runHealthCheck();
    });

    expect(observedDuringCall).toBe(true);
    expect(useMcpStore.getState().health.isChecking).toBe(false);
  });

  it("clears isChecking even when invoke throws", async () => {
    mockRefresh.mockResolvedValue({ running: true, port: 1 });
    mockInvoke.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useMcpHealthCheck());

    await act(async () => {
      await result.current.runHealthCheck();
    });

    expect(useMcpStore.getState().health.isChecking).toBe(false);
  });
});

// Audit #745 — the refresh had already told this call the truth. The catch used
// to report the CLOSURE's `running`/`port`, i.e. the render-time values the
// refresh superseded, so a health check that failed at the sidecar described a
// bridge state that was already known to be wrong.
describe("useMcpHealthCheck — refresh succeeded, sidecar then failed", () => {
  it("reports the refreshed bridge status, not the stale closure values", async () => {
    // Render-time (stale): stopped. Refresh (fresh): running on 5150.
    mcpServerState.running = false;
    mcpServerState.port = null;
    mockRefresh.mockResolvedValue({ running: true, port: 5150 });
    mockInvoke.mockRejectedValue(new Error("sidecar missing"));

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(healthResult.error).toBe("sidecar missing");
    expect(healthResult.bridgeRunning).toBe(true);
    expect(healthResult.bridgePort).toBe(5150);
  });

  it("falls back to the closure values when the refresh itself returned null", async () => {
    mcpServerState.running = true;
    mcpServerState.port = 4242;
    mockRefresh.mockResolvedValue(null);
    mockInvoke.mockRejectedValue(new Error("sidecar missing"));

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(healthResult.bridgeRunning).toBe(true);
    expect(healthResult.bridgePort).toBe(4242);
  });
});

// Audit #743 — `freshStatus?.port ?? port` read a bridge's legitimate
// `port: null` as "absent" and substituted the previous port, so a bridge that
// had just stopped was reported on a port nothing is listening on any more.
// `running` never had the bug (`false ?? x` is `false`), which is why one field
// stayed wrong for so long right beside a correct one.
describe("useMcpHealthCheck — a stopped bridge's null port", () => {
  it("reports null, not the port the bridge used to be on", async () => {
    mcpServerState.running = true;
    mcpServerState.port = 4242;
    mockRefresh.mockResolvedValue({ running: false, port: null });
    mockInvoke.mockResolvedValue({
      status: "ok",
      version: "0.4.0",
      toolCount: 3,
      resourceCount: 0,
      tools: [],
    });

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    expect(healthResult.bridgeRunning).toBe(false);
    expect(healthResult.bridgePort).toBeNull();
    expect(healthResult.success).toBe(false);
  });
});

// Audit #741 — the sidecar probe is the long call, and the verdict has to
// describe the bridge at the END of the check. Reading the status only before
// it made a bridge that stopped mid-check report as running.
describe("useMcpHealthCheck — the bridge changes during the sidecar probe", () => {
  it("reports the status read AFTER the sidecar call", async () => {
    mcpServerState.running = true;
    mcpServerState.port = 5150;
    mockRefresh
      .mockResolvedValueOnce({ running: true, port: 5150 })
      .mockResolvedValueOnce({ running: false, port: null });
    mockInvoke.mockResolvedValue({
      status: "ok",
      version: "0.4.0",
      toolCount: 3,
      resourceCount: 0,
      tools: [],
    });

    const { result } = renderHook(() => useMcpHealthCheck());

    let healthResult!: Awaited<ReturnType<typeof result.current.runHealthCheck>>;
    await act(async () => {
      healthResult = await result.current.runHealthCheck();
    });

    // Both reads happened: the pre-call one is what the catch path reports
    // (#745), the post-call one is what a successful verdict reports.
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(healthResult.bridgeRunning).toBe(false);
    expect(healthResult.bridgePort).toBeNull();
    expect(healthResult.success).toBe(false);
    expect(useMcpStore.getState().health.health.checkError).toBe("mcp.bridgeNotRunning");
  });
});

// Audit #739 — the settings panel's Check button is clickable while a check is
// running, so two overlapping checks are a real input rather than a hypothesis.
describe("useMcpHealthCheck — overlapping checks", () => {
  it("does not let an older check overwrite the newer one's stored health", async () => {
    mockRefresh.mockResolvedValue({ running: true, port: 1 });
    let releaseOlder!: (value: unknown) => void;
    mockInvoke
      .mockImplementationOnce(
        () => new Promise((resolve) => { releaseOlder = resolve; }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          status: "ok",
          version: "newer",
          toolCount: 2,
          resourceCount: 0,
          tools: ["newer.tool"],
        }),
      );

    const { result } = renderHook(() => useMcpHealthCheck());

    let older!: Promise<Awaited<ReturnType<typeof result.current.runHealthCheck>>>;
    await act(async () => {
      older = result.current.runHealthCheck();
    });
    await act(async () => {
      await result.current.runHealthCheck();
    });

    expect(useMcpStore.getState().health.health.version).toBe("newer");
    // The newer check settled, but the older one has not: the panel is still
    // checking, and an unconditional `finally` clear said otherwise.
    expect(useMcpStore.getState().health.isChecking).toBe(true);

    await act(async () => {
      releaseOlder({
        status: "ok",
        version: "older",
        toolCount: 9,
        resourceCount: 0,
        tools: ["older.tool"],
      });
      await older;
    });

    // The older result is still returned to ITS caller; only the store is the
    // newer check's to own.
    expect(useMcpStore.getState().health.health.version).toBe("newer");
    expect(useMcpStore.getState().health.health.tools).toEqual(["newer.tool"]);
    expect(useMcpStore.getState().health.isChecking).toBe(false);
  });
});

// The rule on its own. `??` falls through only on null/undefined, so `running`
// was always right and `port` was always wrong for a stopped bridge — one field
// broken beside a correct one, which is why it survived so long.
describe("latestBridgeStatus", () => {
  const previous = { running: true, port: 4242 };

  it("adopts a fresh answer whole, including a null port", () => {
    expect(latestBridgeStatus({ running: false, port: null }, previous)).toEqual({
      running: false,
      port: null,
    });
  });

  it("adopts a fresh running bridge's port", () => {
    expect(latestBridgeStatus({ running: true, port: 9000 }, previous)).toEqual({
      running: true,
      port: 9000,
    });
  });

  it("keeps what was known when the refresh had no answer", () => {
    expect(latestBridgeStatus(null, previous)).toBe(previous);
  });
});
