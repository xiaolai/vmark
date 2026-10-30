/**
 * IntegrationsSettings — the MCP server controls and the AI provider list:
 * the server toggle drives the bridge, the listening address and client count
 * show only while it runs (the count polled every 5 s), the auto-approve toggle
 * writes its setting, the diagnostics button runs the health check, and the
 * Detect button rescans the PATH rather than replaying the startup scan.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const server = {
  running: false,
  loading: false,
  error: null as string | null,
  port: null as number | null,
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock("@/hooks/useMcpServer", () => ({ useMcpServer: () => server }));

const runHealthCheck = vi.fn();
vi.mock("@/hooks/useMcpHealthCheck", () => ({
  useMcpHealthCheck: () => ({ runHealthCheck, isChecking: false, version: "1.2.3", toolCount: 7, resourceCount: 2 }),
}));

import { IntegrationsSettings } from "./IntegrationsSettings";
import { useSettingsStore } from "@/stores/settingsStore";

const detectCalls = () => invoke.mock.calls.filter(([cmd]) => cmd === "detect_ai_providers");
const clientCountCalls = () => invoke.mock.calls.filter(([cmd]) => cmd === "mcp_bridge_client_count");

async function renderSettings() {
  const view = render(<IntegrationsSettings />);
  await act(async () => {}); // settle the mount effects (detect, diagnose, poll)
  return view;
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "detect_ai_providers") return Promise.resolve([]);
    if (cmd === "mcp_bridge_client_count") return Promise.resolve(3);
    if (cmd === "mcp_config_diagnose") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  Object.assign(server, { running: false, loading: false, error: null, port: null });
  server.start.mockReset().mockResolvedValue(undefined);
  server.stop.mockReset().mockResolvedValue(undefined);
  runHealthCheck.mockReset();
  const mcp = useSettingsStore.getState().advanced.mcpServer;
  useSettingsStore.getState().updateAdvancedSetting("mcpServer", { ...mcp, autoStart: false, autoApproveEdits: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IntegrationsSettings — MCP server", () => {
  it("a stopped server shows Stopped, hides the address and polls no clients", async () => {
    await renderSettings();
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.queryByText("Listening on")).toBeNull();
    expect(clientCountCalls()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Check Sidecar/ })).toBeInTheDocument();
  });

  it("the server toggle starts a stopped bridge and stops a running one", async () => {
    const stopped = await renderSettings();
    await act(async () => screen.getAllByRole("switch")[0].click());
    expect(server.start).toHaveBeenCalledTimes(1);
    stopped.unmount();

    server.running = true;
    server.port = 9000;
    await renderSettings();
    await act(async () => screen.getAllByRole("switch")[0].click());
    expect(server.stop).toHaveBeenCalledTimes(1);
  });

  it("a running server shows its address and the polled client count, every 5 s", async () => {
    vi.useFakeTimers();
    server.running = true;
    server.port = 9000;
    await renderSettings();
    expect(screen.getByText("localhost:9000")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(clientCountCalls()).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(clientCountCalls()).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Test Connection/ })).toBeInTheDocument();
  });

  it("the auto-approve toggle writes autoApproveEdits", async () => {
    await renderSettings();
    await act(async () => screen.getAllByRole("switch")[2].click());
    expect(useSettingsStore.getState().advanced.mcpServer.autoApproveEdits).toBe(true);
  });

  it("the diagnostics button runs the health check", async () => {
    await renderSettings();
    await act(async () => screen.getByRole("button", { name: /Check Sidecar/ }).click());
    expect(runHealthCheck).toHaveBeenCalledTimes(1);
  });
});

describe("IntegrationsSettings — AI providers", () => {
  it("mounting replays the cached scan; Detect asks for a fresh one", async () => {
    await renderSettings();
    expect(detectCalls()).toEqual([["detect_ai_providers", { refresh: false }]]);
    await act(async () => screen.getByText("Detect").closest("button")!.click());
    expect(detectCalls().at(-1)).toEqual(["detect_ai_providers", { refresh: true }]);
  });
});
