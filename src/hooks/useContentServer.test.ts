// H7 — useContentServer drives the store from the service, per workspace.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const startContentServer = vi.fn();
const stopContentServer = vi.fn();
const openKbInBrowser = vi.fn();
const getKbAuthUrl = vi.fn();
const getContentServerStatus = vi.fn();
const startSlidevPreview = vi.fn();
const exportSlidev = vi.fn();
vi.mock("@/services/contentServer", () => ({
  startContentServer: (...a: unknown[]) => startContentServer(...a),
  stopContentServer: (...a: unknown[]) => stopContentServer(...a),
  openKbInBrowser: (...a: unknown[]) => openKbInBrowser(...a),
  getKbAuthUrl: (...a: unknown[]) => getKbAuthUrl(...a),
  getContentServerStatus: (...a: unknown[]) => getContentServerStatus(...a),
  startSlidevPreview: (...a: unknown[]) => startSlidevPreview(...a),
  exportSlidev: (...a: unknown[]) => exportSlidev(...a),
}));

const toastErrorMock = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...a: unknown[]) => toastErrorMock(...a), info: vi.fn(), success: vi.fn() },
}));

const openUrlMock = vi.fn();
const saveMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrlMock(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => saveMock(...a) }));

const findTabByIdMock = vi.fn();
vi.mock("@/services/navigation/activeDocument", () => ({ getActiveTabId: () => "t1" }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ findTabById: (...a: unknown[]) => findTabByIdMock(...a) }) },
  tabFilePath: (t: { kind?: string; filePath?: string | null }) =>
    t?.kind === "document" ? (t.filePath ?? null) : null,
}));

type ExitPayload = { workspaceRoot: string; code: number | null };
let exitHandler: ((e: { payload: ExitPayload }) => void) | null = null;
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (e: { payload: ExitPayload }) => void) => {
    if (event === "content-server:exited") exitHandler = cb;
    return Promise.resolve(unlisten);
  },
}));

import {
  useContentServer,
  MAX_TRUST_RECONCILES,
} from "./useContentServer";
// The crash supervisor moved to a sibling hook when this file hit the size cap.
import {
  shouldAutoRestart,
  MAX_CONTENT_SERVER_RESTARTS,
} from "./useContentServerSupervisor";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { normalizeWorkspaceConfig } from "@/stores/workspaceConfigDefaults";

/** Give the workspace a config whose identity carries the given trust. */
function setTrust(trusted: boolean) {
  const config = normalizeWorkspaceConfig(useWorkspaceStore.getState().config);
  useWorkspaceStore.setState({
    config: {
      ...config,
      identity: {
        id: "ws-id",
        createdAt: 1,
        trustLevel: trusted ? "trusted" : "untrusted",
        trustedAt: trusted ? 1 : null,
      },
    },
  });
}

// Control the clock. The stop-intent guard used to be a fire-and-forget
// 3-second timer, which made crash classification depend on how long the
// suite took under parallel load; it is root-scoped and timer-free now
// (audit #367/#371), and the fake clock is what lets a test PROVE that by
// advancing far past the old window before delivering the exit.
beforeEach(() => {
  vi.useFakeTimers();
  startContentServer.mockReset();
  stopContentServer.mockReset();
  openKbInBrowser.mockReset();
  getKbAuthUrl.mockReset();
  getKbAuthUrl.mockResolvedValue("http://127.0.0.1:7/__auth?t=n");
  getContentServerStatus.mockReset().mockResolvedValue(null);
  toastErrorMock.mockReset();
  startSlidevPreview.mockReset();
  exportSlidev.mockReset();
  openUrlMock.mockReset();
  saveMock.mockReset();
  findTabByIdMock.mockReset().mockReturnValue({ kind: "document", filePath: "/ws/deck.md" });
  unlisten.mockReset();
  exitHandler = null;
  useContentServerStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useContentServer", () => {
  it("start → running with url/port", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    expect(startContentServer).toHaveBeenCalledWith("/ws", false);
    const s = useContentServerStore.getState();
    expect(s.status).toBe("running");
    expect(s.port).toBe(7);
    expect(getKbAuthUrl).toHaveBeenCalledWith("/ws");
    expect(s.iframeUrl).toBe("http://127.0.0.1:7/__auth?t=n");
  });

  it("start without a workspace sets an error", async () => {
    useWorkspaceStore.setState({ rootPath: null });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    expect(startContentServer).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("error");
  });

  it("start failure surfaces the error", async () => {
    startContentServer.mockRejectedValue(new Error("spawn boom"));
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    expect(useContentServerStore.getState().error).toMatch(/spawn boom/);
  });

  // WI-DP2.6 — content_server commands return Result<_, CommandError>, so a
  // rejection is a plain OBJECT, not an Error. The old `String(e)` rendered it
  // as "[object Object]" and the panel showed that to the user.
  it("start failure surfaces a TYPED CommandError's message, not [object Object]", async () => {
    startContentServer.mockRejectedValue({
      code: "timeout",
      message: "content server did not report a port in time",
    });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    expect(useContentServerStore.getState().error).toBe(
      "content server did not report a port in time",
    );
  });

  // Codex audit — the server is up, only the nonce URL failed: stay running so
  // the iframe can retry, but never leave a dead `/__auth` link behind.
  it("stays running and clears the iframe URL when only the auth URL fails", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    getKbAuthUrl.mockRejectedValue(new Error("mint failed"));
    useContentServerStore.getState().setIframeUrl("http://127.0.0.1:7/__auth?t=stale");
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    const s = useContentServerStore.getState();
    expect(s.status).toBe("running");
    expect(s.port).toBe(7);
    expect(s.iframeUrl).toBeNull();
    expect(s.error).toBeNull();
  });

  it("stop calls the service and resets the store", async () => {
    stopContentServer.mockResolvedValue(undefined);
    useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    expect(stopContentServer).toHaveBeenCalledWith("/ws");
    expect(useContentServerStore.getState().status).toBe("stopped");
  });

  it("openInBrowser delegates to the service", async () => {
    openKbInBrowser.mockResolvedValue("http://127.0.0.1:7/__auth?t=n");
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.openInBrowser();
    });
    expect(openKbInBrowser).toHaveBeenCalledWith("/ws");
  });


  it("auto-restarts the server on a crash event for the active workspace", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    renderHook(() => useContentServer());
    expect(exitHandler).toBeTruthy();
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
    });
    expect(startContentServer).toHaveBeenCalledWith("/ws", false);
  });

  it("ignores crash events for a different workspace", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    renderHook(() => useContentServer());
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/other", code: 1 } });
    });
    expect(startContentServer).not.toHaveBeenCalled();
  });

  it("does not restart when a crash signal races a user-initiated stop", async () => {
    // The genuine race: the supervisor polled and emitted BEFORE the manager
    // dropped the registration, so the event is in flight while the user's
    // stop is. Deliver it there — after the stop settles, the registration is
    // gone and no event for that child can follow (see the #367 test below).
    let settleStop: (() => void) | null = null;
    stopContentServer.mockImplementation(
      () => new Promise<void>((resolve) => (settleStop = () => resolve())),
    );
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    const { result } = renderHook(() => useContentServer());
    let stopped: Promise<void> | null = null;
    await act(async () => {
      stopped = result.current.stop();
      await Promise.resolve();
    });
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 0 } });
    });
    await act(async () => {
      settleStop?.();
      await stopped;
    });
    expect(startContentServer).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("stopped");
  });

  // Audit 20260907 (#366): a stop whose backend call failed was still reported
  // as stopped — a live child shown as gone, with no way to see why.
  it("a failed stop surfaces the error and does not report the server as stopped", async () => {
    stopContentServer.mockRejectedValue(new Error("stop refused"));
    getContentServerStatus.mockResolvedValue(null); // the backend says the child IS gone
    useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    const s = useContentServerStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/stop refused/);
  });

  // Audit #719 — a refused stop that left the child SERVING was modelled as
  // `error`, and `useContentServerWorkspaceSync` acts only on `running`: the
  // live child then went on serving the old CSP through every later trust flip,
  // because nothing was watching it any more. The status has to describe the
  // child, so it is re-queried rather than assumed.
  it("a failed stop over a still-running child reports running, with the failure as a toast", async () => {
    stopContentServer.mockRejectedValue(new Error("stop refused"));
    getContentServerStatus.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    const s = useContentServerStore.getState();
    expect(s.status).toBe("running");
    expect(s.port).toBe(7);
    expect(toastErrorMock.mock.calls.flat().join(" ")).toMatch(/stop refused/);
  });

  // Audit 20260907 (#367): the stop-intent guard was a 3-second timer, so a
  // legitimately delayed exit of the stopped server counted as a crash and
  // restarted what the user had just stopped. The intent covers the whole
  // in-flight stop instead — no clock, however long the backend takes.
  it("a stop-intent is not time-bounded: an exit during a SLOW stop is the stop, not a crash", async () => {
    let settleStop: (() => void) | null = null;
    stopContentServer.mockImplementation(
      () => new Promise<void>((resolve) => (settleStop = () => resolve())),
    );
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    const { result } = renderHook(() => useContentServer());
    let stopped: Promise<void> | null = null;
    await act(async () => {
      stopped = result.current.stop();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 0 } });
    });
    await act(async () => {
      settleStop?.();
      await stopped;
    });
    expect(startContentServer).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("stopped");
  });

  // Audit 20260907 (#367), round 4: releasing the intent when the stop SETTLES
  // assumed the only exit that could still arrive was one emitted after it —
  // and there is no such exit. The one that exists was emitted BEFORE the stop
  // (the supervisor polled, saw the child gone, removed the registration and
  // emitted; the user's stop then found nothing to take and returned Ok), and
  // its delivery is not ordered against the stop's own reply. Delivered one
  // task later, it read as a crash and restarted the server the user had just
  // stopped.
  it("an exit emitted before the stop but delivered after it does not restart the server", async () => {
    stopContentServer.mockResolvedValue(undefined);
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
    });
    expect(startContentServer).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("stopped");
  });

  // …and the guard is still SPENT by that echo, which is what keeps round 3's
  // property: at most one exit can predate a stop (the supervisor thread ends
  // with the emit, and a later exit needs a new child, hence a new start), so a
  // second one is a genuine crash and restarts. Only a permanent guard would
  // leave a real crash unreported for the life of the window.
  it("the guard is spent by the exit it absorbs: the next exit is a crash", async () => {
    stopContentServer.mockResolvedValue(undefined);
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
    });
    expect(startContentServer).not.toHaveBeenCalled();
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
    });
    expect(startContentServer).toHaveBeenCalledWith("/ws", false);
  });

  // A stop that the backend REFUSED never acknowledged anything, so the child
  // may still be alive and its exit is still the stop's (#366 + #367).
  it("a refused stop leaves no stop-intent: the next exit is a crash", async () => {
    stopContentServer.mockRejectedValue(new Error("stop refused"));
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
    });
    expect(startContentServer).toHaveBeenCalledWith("/ws", false);
  });

  // Audit 20260907 (#371): the intent was a global boolean, so a stop in one
  // workspace suppressed a genuine crash in the workspace switched to next.
  it("a crash in ANOTHER workspace right after a stop is not suppressed", async () => {
    stopContentServer.mockResolvedValue(undefined);
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:8", port: 8, trusted: false });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    useWorkspaceStore.setState({ rootPath: "/other" });
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/other", code: 1 } });
    });
    expect(startContentServer).toHaveBeenCalledWith("/other", false);
  });

  it("gives up after the restart cap and surfaces an error", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    renderHook(() => useContentServer());
    for (let i = 0; i < MAX_CONTENT_SERVER_RESTARTS; i++) {
      await act(async () => {
        exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
      });
    }
    expect(startContentServer).toHaveBeenCalledTimes(MAX_CONTENT_SERVER_RESTARTS);
    startContentServer.mockClear();
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
    });
    expect(startContentServer).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("error");
  });

  // Audit #363–#365, #370 — one lifecycle operation owns the store at a time.
  // Every start/stop takes the next generation; a result that arrives after a
  // later operation began, or after the workspace moved on, is dropped.
  describe("lifecycle generations", () => {
    it("a crash restart racing an in-flight start commits only the later start's handle (#364)", async () => {
      let resolveFirst: ((h: unknown) => void) | undefined;
      startContentServer
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce({ url: "http://127.0.0.1:8", port: 8, trusted: false });
      const { result } = renderHook(() => useContentServer());
      let first: Promise<void> | undefined;
      await act(async () => {
        first = result.current.start();
      });
      // The supervisor restarts on a crash signal while the manual start is
      // still in flight; its start resolves first.
      await act(async () => {
        exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
      });
      expect(useContentServerStore.getState().port).toBe(8);
      // The older start resolves last: its handle is stale and must not win.
      await act(async () => {
        resolveFirst?.({ url: "http://127.0.0.1:7", port: 7, trusted: false });
        await first;
      });
      const s = useContentServerStore.getState();
      expect(s.status).toBe("running");
      expect(s.port).toBe(8);
      expect(s.url).toBe("http://127.0.0.1:8");
    });

    it("a stop superseded by a later start does not hide the server that start brought up (#365)", async () => {
      useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
      let releaseStop: (() => void) | undefined;
      stopContentServer.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseStop = resolve;
          }),
      );
      startContentServer.mockResolvedValue({ url: "http://127.0.0.1:9", port: 9, trusted: false });
      const { result } = renderHook(() => useContentServer());
      let stopping: Promise<void> | undefined;
      await act(async () => {
        stopping = result.current.stop();
      });
      await act(async () => {
        await result.current.start();
      });
      expect(useContentServerStore.getState().port).toBe(9);
      await act(async () => {
        releaseStop?.();
        await stopping;
      });
      const s = useContentServerStore.getState();
      expect(s.status).toBe("running");
      expect(s.port).toBe(9);
    });

    it("a start whose workspace moved on before it resolved is dropped, not published into the new workspace (#363)", async () => {
      let resolveStart: ((h: unknown) => void) | undefined;
      startContentServer.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStart = resolve;
          }),
      );
      const { result } = renderHook(() => useContentServer());
      let started: Promise<void> | undefined;
      await act(async () => {
        started = result.current.start();
      });
      expect(useContentServerStore.getState().status).toBe("starting");
      useWorkspaceStore.setState({ rootPath: "/elsewhere" });
      await act(async () => {
        resolveStart?.({ url: "http://127.0.0.1:7", port: 7, trusted: false });
        await started;
      });
      const s = useContentServerStore.getState();
      // Not "running" with the old workspace's URL — and not stuck at
      // "starting" either: this window knows of no server for the new root.
      expect(s.status).toBe("stopped");
      expect(s.url).toBeNull();
      expect(s.iframeUrl).toBeNull();
      expect(getKbAuthUrl).not.toHaveBeenCalled();
    });

    it("a trust flip during a reconcile's auth step does not let the older reconcile keep issuing starts (#370)", async () => {
      setTrust(true);
      startContentServer
        .mockResolvedValueOnce({ url: "http://127.0.0.1:7", port: 7, trusted: true }) // manual start
        .mockResolvedValueOnce({ url: "http://127.0.0.1:8", port: 8, trusted: false }) // reconcile A (untrust)
        .mockResolvedValueOnce({ url: "http://127.0.0.1:9", port: 9, trusted: true }) // reconcile B (re-trust)
        .mockResolvedValue({ url: "http://127.0.0.1:10", port: 10, trusted: true }); // any further start is the defect
      let releaseAuthA: ((url: string) => void) | undefined;
      getKbAuthUrl
        .mockResolvedValueOnce("http://127.0.0.1:7/__auth?t=1")
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseAuthA = resolve;
            }),
        )
        .mockResolvedValue("http://127.0.0.1:9/__auth?t=3");
      const { result } = renderHook(() => useContentServer());
      await act(async () => {
        await result.current.start();
      });
      // Reconcile A: its start resolved (port 8) and it is waiting on the auth
      // URL — the store already says running, so a second flip is not gated.
      await act(async () => {
        useWorkspaceStore.getState().untrustWorkspace();
      });
      expect(useContentServerStore.getState().port).toBe(8);
      await act(async () => {
        useWorkspaceStore.getState().trustWorkspace();
      });
      expect(useContentServerStore.getState().port).toBe(9);
      // A wakes up superseded: no further start, no overwrite.
      await act(async () => {
        releaseAuthA?.("http://127.0.0.1:8/__auth?t=2");
      });
      expect(startContentServer).toHaveBeenCalledTimes(3);
      const s = useContentServerStore.getState();
      expect(s.port).toBe(9);
      expect(s.iframeUrl).toBe("http://127.0.0.1:9/__auth?t=3");
    });
  });

  // WI-FL3.6 — trust changes the served pages' CSP (remote https: images), and
  // the CSP is baked into the child at spawn. So the start carries the live
  // trust value, and a flip while serving restarts the server with the new one.
  describe("workspace trust", () => {
    it("starts a trusted workspace's server with trusted: true", async () => {
      setTrust(true);
      startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: true });
      const { result } = renderHook(() => useContentServer());
      await act(async () => {
        await result.current.start();
      });
      expect(startContentServer).toHaveBeenCalledWith("/ws", true);
      expect(useContentServerStore.getState().status).toBe("running");
    });

    it("restarts a running server when trust is revoked, so the CSP follows", async () => {
      setTrust(true);
      startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: true });
      const { result } = renderHook(() => useContentServer());
      await act(async () => {
        await result.current.start();
      });
      startContentServer.mockClear();
      startContentServer.mockResolvedValue({ url: "http://127.0.0.1:8", port: 8, trusted: false });
      await act(async () => {
        useWorkspaceStore.getState().untrustWorkspace();
      });
      expect(startContentServer).toHaveBeenCalledTimes(1);
      expect(startContentServer).toHaveBeenCalledWith("/ws", false);
      const s = useContentServerStore.getState();
      expect(s.status).toBe("running");
      expect(s.port).toBe(8);
    });

    it("also restarts when trust is granted while serving", async () => {
      setTrust(false);
      startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
      const { result } = renderHook(() => useContentServer());
      await act(async () => {
        await result.current.start();
      });
      startContentServer.mockClear();
      startContentServer.mockResolvedValue({ url: "http://127.0.0.1:9", port: 9, trusted: true });
      await act(async () => {
        useWorkspaceStore.getState().trustWorkspace();
      });
      expect(startContentServer).toHaveBeenCalledWith("/ws", true);
      expect(useContentServerStore.getState().port).toBe(9);
    });

    it("does nothing on a trust change while the server is stopped", async () => {
      setTrust(true);
      renderHook(() => useContentServer());
      await act(async () => {
        useWorkspaceStore.getState().untrustWorkspace();
      });
      expect(startContentServer).not.toHaveBeenCalled();
      expect(useContentServerStore.getState().status).toBe("stopped");
    });

    it("re-issues the start when the server came up with stale trust (flip while starting)", async () => {
      setTrust(true);
      let resolveFirst: ((h: unknown) => void) | undefined;
      startContentServer
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce({ url: "http://127.0.0.1:8", port: 8, trusted: false });
      const { result } = renderHook(() => useContentServer());
      let started: Promise<void> | undefined;
      await act(async () => {
        started = result.current.start();
      });
      expect(startContentServer).toHaveBeenCalledWith("/ws", true);
      // Trust flips while the first start is in flight: the server that comes
      // up was spawned with trusted=true, which the handle reports.
      await act(async () => {
        useWorkspaceStore.getState().untrustWorkspace();
      });
      await act(async () => {
        resolveFirst?.({ url: "http://127.0.0.1:7", port: 7, trusted: true });
        await started;
      });
      expect(startContentServer).toHaveBeenCalledTimes(2);
      expect(startContentServer).toHaveBeenLastCalledWith("/ws", false);
      expect(useContentServerStore.getState().port).toBe(8);
    });

    it("bounds the reconcile, and FAILS CLOSED when trust never settles (audit #717)", async () => {
      // A handle whose `trusted` never matches the live value must not spin
      // forever: at most MAX_TRUST_RECONCILES extra starts. What it must ALSO
      // not do is publish the mismatched server once the bound is reached —
      // that was fail-open, advertising a child whose CSP contradicts the live
      // trust setting, which is the one thing the reconcile exists to prevent.
      setTrust(false);
      startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: true });
      const { result } = renderHook(() => useContentServer());
      await act(async () => {
        await result.current.start();
      });
      expect(startContentServer).toHaveBeenCalledTimes(1 + MAX_TRUST_RECONCILES);
      const s = useContentServerStore.getState();
      expect(s.status).toBe("error");
      expect(s.url).toBeNull();
      expect(s.error).toBeTruthy();
    });

    it("never publishes a stale-trust handle while reconciling (audit #716)", async () => {
      // The mismatched first handle used to be announced as running AND handed
      // a fresh `/__auth` nonce before its trust was compared — a live, in-app
      // window onto a server enforcing the CSP the user had just revoked.
      setTrust(false);
      startContentServer
        .mockResolvedValueOnce({ url: "http://127.0.0.1:7", port: 7, trusted: true })
        .mockResolvedValueOnce({ url: "http://127.0.0.1:8", port: 8, trusted: false });
      const seen: string[] = [];
      const unsub = useContentServerStore.subscribe((st) => {
        if (st.status === "running" && st.url && seen[seen.length - 1] !== st.url) {
          seen.push(st.url);
        }
      });
      const { result } = renderHook(() => useContentServer());
      await act(async () => {
        await result.current.start();
      });
      unsub();
      expect(seen).toEqual(["http://127.0.0.1:8"]);
      // …and only the SETTLED server ever got an auth URL minted for it.
      expect(getKbAuthUrl).toHaveBeenCalledTimes(1);
    });

    it("does not reconcile against a handle that carries no trust at all", async () => {
      setTrust(false);
      startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7 });
      const { result } = renderHook(() => useContentServer());
      await act(async () => {
        await result.current.start();
      });
      expect(startContentServer).toHaveBeenCalledTimes(1);
    });
  });
});

// Audit #513 — a server the store reports as running belongs to the root it
// was started for. Switching workspace used to leave that root's URL in the
// Knowledge Base panel: nothing reset the store.
describe("useContentServer — workspace switch (audit #513)", () => {
  it("a switch while running says stopped instead of keeping the old root's URL", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    expect(useContentServerStore.getState().status).toBe("running");

    await act(async () => {
      useWorkspaceStore.getState().openWorkspace("/other");
    });

    const s = useContentServerStore.getState();
    expect(s.status).toBe("stopped");
    expect(s.url).toBeNull();
    expect(s.iframeUrl).toBeNull();
    // The child may be serving another window: the store transition is the whole verdict.
    expect(stopContentServer).not.toHaveBeenCalled();
  });

  it("a switch to a workspace with different trust does not start a server for the new root", async () => {
    setTrust(false);
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      useWorkspaceStore.getState().openWorkspace("/other", {
        ...normalizeWorkspaceConfig(null),
        identity: { id: "other", createdAt: 1, trustLevel: "trusted", trustedAt: 1 },
      });
    });

    expect(startContentServer).toHaveBeenCalledTimes(1);
    expect(useContentServerStore.getState().status).toBe("stopped");
  });
});

describe("shouldAutoRestart", () => {
  it("allows restarts below the cap and stops at it", () => {
    expect(shouldAutoRestart(0)).toBe(true);
    expect(shouldAutoRestart(MAX_CONTENT_SERVER_RESTARTS - 1)).toBe(true);
    expect(shouldAutoRestart(MAX_CONTENT_SERVER_RESTARTS)).toBe(false);
  });
});

// Audit #718 — the stop path's guard was generation-only, and a workspace
// switch does not touch the generation. So a stop that failed for workspace A
// wrote its error over workspace B's store, which the sync hook had just reset
// to `stopped` for a root this window is not serving at all.
describe("a stop whose workspace moved on (#718)", () => {
  it("does not write its failure over the new workspace's status", async () => {
    let rejectStop: (e: unknown) => void = () => undefined;
    stopContentServer.mockImplementation(
      () => new Promise((_resolve, reject) => (rejectStop = reject)),
    );
    const { result } = renderHook(() => useContentServer());

    let stopping!: Promise<void>;
    act(() => {
      stopping = result.current.stop();
    });
    // The user switches workspace while the stop is still in flight; the sync
    // hook has already put the store at `stopped` for the NEW root.
    useWorkspaceStore.setState({ rootPath: "/other" });
    useContentServerStore.getState().stop();

    await act(async () => {
      rejectStop(new Error("stop refused"));
      await stopping;
    });

    expect(useContentServerStore.getState().status).toBe("stopped");
    expect(useContentServerStore.getState().error).toBeNull();
    // …and it must not have interrogated the workspace it no longer serves.
    expect(getContentServerStatus).not.toHaveBeenCalled();
  });
});

// Audit #724 — the crash listener used to depend on `useTranslation`'s `t`,
// whose identity changes with the language. `listen()` is async, so every
// change tore the listener down and left a window with no supervision at all;
// a crash landing in it was lost silently.
describe("the crash listener survives a new translation function (#724)", () => {
  it("is not torn down and re-registered when the hook re-renders", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7, trusted: false });
    const { result, rerender } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    const handlerBefore = exitHandler;

    rerender();
    await act(async () => {});

    expect(unlisten).not.toHaveBeenCalled();
    expect(exitHandler).toBe(handlerBefore);
  });
});
