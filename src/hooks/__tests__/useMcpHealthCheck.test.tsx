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

import { useMcpHealthCheck } from "../useMcpHealthCheck";
import { useMcpHealthStore } from "@/stores/mcpHealthStore";

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  useMcpHealthStore.getState().reset();
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

    const stored = useMcpHealthStore.getState().health;
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

    const stored = useMcpHealthStore.getState().health;
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

    const stored = useMcpHealthStore.getState().health;
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
    expect(useMcpHealthStore.getState().health.checkError).toBe(
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
    useMcpHealthStore.setState({
      health: {
        version: "0.3.0",
        toolCount: 5,
        resourceCount: 3,
        tools: ["doc.read", "doc.write", "doc.list"],
        lastChecked: new Date("2026-01-01T00:00:00Z"),
        checkError: null,
      },
    });

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

    const stored = useMcpHealthStore.getState().health;
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
      observedDuringCall = useMcpHealthStore.getState().isChecking;
      return {
        status: "ok",
        version: "0.4.0",
        toolCount: 1,
        resourceCount: 0,
        tools: [],
      };
    });

    const { result } = renderHook(() => useMcpHealthCheck());

    expect(useMcpHealthStore.getState().isChecking).toBe(false);

    await act(async () => {
      await result.current.runHealthCheck();
    });

    expect(observedDuringCall).toBe(true);
    expect(useMcpHealthStore.getState().isChecking).toBe(false);
  });

  it("clears isChecking even when invoke throws", async () => {
    mockRefresh.mockResolvedValue({ running: true, port: 1 });
    mockInvoke.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useMcpHealthCheck());

    await act(async () => {
      await result.current.runHealthCheck();
    });

    expect(useMcpHealthStore.getState().isChecking).toBe(false);
  });
});
