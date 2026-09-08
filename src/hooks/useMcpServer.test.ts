// WI-FL5.5 — useMcpServer: start/stop through the hook, status events from
// Rust, and the error path. Behaviour, not wiring: assertions land on the
// hook's returned state and on the exact command each control sends.
//
// Only the Tauri boundary is faked — `invoke` as a mock, `listen` as a real
// per-event registry, so a Rust-side event can be DELIVERED and an unmount can
// be shown to remove the handler rather than "unlisten was called".
//
// Cases marked [characterization] record what the hook does today so that a
// change is deliberate — they are not an endorsement. The ones that look like
// defects are listed in the plan's WI-FL5.5 status trail.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Handler = (event: { payload: unknown }) => void;

const { registry, invokeMock } = vi.hoisted(() => ({
  registry: new Map<string, Set<Handler>>(),
  invokeMock: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  // Forwarded verbatim so an argument the hook does NOT pass is observable.
  invoke: (...args: [string, unknown?]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: Handler) => {
    let handlers = registry.get(event);
    if (!handlers) {
      handlers = new Set();
      registry.set(event, handlers);
    }
    handlers.add(handler);
    return Promise.resolve(() => {
      registry.get(event)?.delete(handler);
    });
  },
}));

import { useMcpServer } from "./useMcpServer";

/** Deliver a Rust-side event to every live listener. */
function emit(event: string, payload?: unknown): void {
  for (const handler of registry.get(event) ?? []) handler({ payload });
}

function listenerCount(event: string): number {
  return registry.get(event)?.size ?? 0;
}

const STOPPED = { running: false, port: null };
const RUNNING = { running: true, port: 51234 };

/** Route commands like the Rust side does: each of the three answers with a status. */
function routeInvoke(responses: { status?: unknown; start?: unknown; stop?: unknown } = {}) {
  invokeMock.mockImplementation((cmd) => {
    switch (cmd) {
      case "mcp_server_status":
        return Promise.resolve(responses.status ?? STOPPED);
      case "mcp_bridge_start":
        return Promise.resolve(responses.start ?? RUNNING);
      case "mcp_bridge_stop":
        return Promise.resolve(responses.stop ?? STOPPED);
      default:
        return Promise.reject(new Error(`unexpected command ${cmd}`));
    }
  });
}

function commandsSent(): string[] {
  return invokeMock.mock.calls.map(([cmd]) => cmd);
}

beforeEach(() => {
  registry.clear();
  invokeMock.mockReset();
  routeInvoke();
});

/** Mount and let the effect's status refresh and event subscriptions settle. */
async function mount() {
  const hook = renderHook(() => useMcpServer());
  await waitFor(() => expect(commandsSent()).toContain("mcp_server_status"));
  await act(async () => {});
  return hook;
}

describe("useMcpServer", () => {
  describe("mount", () => {
    it("reflects the bridge status Rust reports", async () => {
      routeInvoke({ status: RUNNING });
      const { result } = await mount();
      await waitFor(() => expect(result.current.running).toBe(true));
      expect(result.current.port).toBe(51234);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it("starts from not-running with no port until the status arrives", async () => {
      const { result } = await mount();
      expect(result.current.running).toBe(false);
      expect(result.current.port).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("surfaces a status failure as `error` and keeps the not-running defaults", async () => {
      invokeMock.mockImplementation((cmd) =>
        cmd === "mcp_server_status"
          ? Promise.reject(new Error("bridge state poisoned"))
          : Promise.resolve(STOPPED),
      );
      const { result } = await mount();
      await waitFor(() => expect(result.current.error).toBe("bridge state poisoned"));
      expect(result.current.running).toBe(false);
      expect(result.current.port).toBeNull();
    });

    // Audit #384 — a transition between the status snapshot and the listeners
    // going live would be lost until the next event. Observed at the moment
    // Rust would answer the snapshot: both listeners are already registered.
    it("subscribes to both bridge events BEFORE the first status read", async () => {
      let listenersAtSnapshot = -1;
      invokeMock.mockImplementation((cmd) => {
        if (cmd === "mcp_server_status") {
          listenersAtSnapshot = listenerCount("mcp-server:started") + listenerCount("mcp-server:stopped");
        }
        return Promise.resolve(STOPPED);
      });
      await mount();
      expect(listenersAtSnapshot).toBe(2);
    });

    it("subscribes once to each of the two bridge events Rust emits (no `sidecar-terminated` emitter exists)", async () => {
      await mount();
      expect(listenerCount("mcp-server:started")).toBe(1);
      expect(listenerCount("mcp-server:stopped")).toBe(1);
      expect(listenerCount("mcp-server:sidecar-terminated")).toBe(0);
    });
  });

  describe("start()", () => {
    it("sends mcp_bridge_start with NO arguments and adopts the reported status (D9)", async () => {
      const { result } = await mount();
      await act(async () => {
        await result.current.start();
      });
      // The OS assigns the port; the hook asks for none (WI-FL2.1 removed the
      // ignored `port` argument). Exactly one argument: the command name.
      const startCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "mcp_bridge_start");
      expect(startCalls).toEqual([["mcp_bridge_start"]]);
      expect(result.current.running).toBe(true);
      expect(result.current.port).toBe(51234);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it("reports `loading` while the command is in flight", async () => {
      let release: (status: unknown) => void = () => {};
      invokeMock.mockImplementation((cmd) =>
        cmd === "mcp_bridge_start"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(STOPPED),
      );
      const { result } = await mount();

      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.start();
      });
      await waitFor(() => expect(result.current.loading).toBe(true));
      expect(result.current.running).toBe(false);

      await act(async () => {
        release(RUNNING);
        await pending;
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.running).toBe(true);
    });

    it("on failure: records the message, rethrows so the caller can react, clears `loading`", async () => {
      const { result } = await mount();
      // The bridge commands are legacy `Result<T, String>`: a refusal arrives
      // as a bare string, which errorMessage() renders verbatim.
      invokeMock.mockRejectedValueOnce("bind failed: address in use");

      // Caught INSIDE act: a callback that rejects makes act() discard its
      // queued updates, which would hide the very setError() under test.
      let thrown: unknown;
      await act(async () => {
        try {
          await result.current.start();
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBe("bind failed: address in use");
      expect(result.current.error).toBe("bind failed: address in use");
      expect(result.current.running).toBe(false);
      expect(result.current.port).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it("clears the previous error when a retry succeeds", async () => {
      const { result } = await mount();
      invokeMock.mockRejectedValueOnce(new Error("bind failed"));
      let thrown: unknown;
      await act(async () => {
        try {
          await result.current.start();
        } catch (error) {
          thrown = error;
        }
      });
      expect(thrown).toBeInstanceOf(Error);
      expect(result.current.error).toBe("bind failed");

      await act(async () => {
        await result.current.start();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.running).toBe(true);
    });
  });

  describe("stop()", () => {
    it("sends mcp_bridge_stop and adopts the reported status", async () => {
      routeInvoke({ status: RUNNING });
      const { result } = await mount();
      await waitFor(() => expect(result.current.running).toBe(true));

      await act(async () => {
        await result.current.stop();
      });

      const stopCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "mcp_bridge_stop");
      expect(stopCalls).toEqual([["mcp_bridge_stop"]]);
      expect(result.current.running).toBe(false);
      expect(result.current.port).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it("on failure: records the message, rethrows, and leaves `running` as it was", async () => {
      routeInvoke({ status: RUNNING });
      const { result } = await mount();
      await waitFor(() => expect(result.current.running).toBe(true));
      invokeMock.mockRejectedValueOnce(new Error("shutdown timed out"));

      let thrown: unknown;
      await act(async () => {
        try {
          await result.current.stop();
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe("shutdown timed out");
      expect(result.current.error).toBe("shutdown timed out");
      expect(result.current.running).toBe(true);
      expect(result.current.port).toBe(51234);
      expect(result.current.loading).toBe(false);
    });
  });

  // Audit #382 — start, stop and refresh run one at a time in the order they
  // were issued, so Rust sees them in that order and an older completion can
  // never land on top of a newer one; `loading` stays on until the LAST
  // pending mutation settles, not the first.
  describe("sequencing", () => {
    it("runs start and stop one at a time, in the order issued; loading clears only when both are done", async () => {
      const pending: Array<{ cmd: string; resolve: (status: unknown) => void }> = [];
      invokeMock.mockImplementation((cmd) =>
        cmd === "mcp_server_status"
          ? Promise.resolve(STOPPED)
          : new Promise((resolve) => {
              pending.push({ cmd, resolve });
            }),
      );
      const { result } = await mount();

      let starting: Promise<void> = Promise.resolve();
      let stopping: Promise<void> = Promise.resolve();
      act(() => {
        starting = result.current.start();
        stopping = result.current.stop();
      });
      await act(async () => {});
      // Only the start has reached Rust; the stop waits behind it.
      expect(pending.map((p) => p.cmd)).toEqual(["mcp_bridge_start"]);
      expect(result.current.loading).toBe(true);

      await act(async () => {
        pending[0]?.resolve(RUNNING);
        await starting;
      });
      expect(result.current.running).toBe(true);
      // The stop is still pending: one completion must not clear the other's loading.
      expect(result.current.loading).toBe(true);
      await act(async () => {});
      expect(pending.map((p) => p.cmd)).toEqual(["mcp_bridge_start", "mcp_bridge_stop"]);

      await act(async () => {
        pending[1]?.resolve(STOPPED);
        await stopping;
      });
      expect(result.current.running).toBe(false);
      expect(result.current.port).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  // Audit #382 (round 2) — Rust's events are the source of truth. A command's
  // returned status is a snapshot taken before the response travelled, so a
  // snapshot that raced an event is OLDER than the state the event wrote and
  // must not overwrite it. Command responses and events reach the webview on
  // different channels, with no ordering between them.
  describe("stale snapshots lose to events (#382)", () => {
    it("a bridge event that lands while a refresh is in flight wins over the refresh's older snapshot", async () => {
      const { result } = await mount();
      let release: (status: unknown) => void = () => {};
      invokeMock.mockImplementation((cmd) =>
        cmd === "mcp_server_status"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(STOPPED),
      );

      let refreshing: Promise<unknown> = Promise.resolve();
      act(() => {
        refreshing = result.current.refresh();
      });
      await act(async () => {});
      // The bridge came up after the snapshot was taken but before it was delivered.
      act(() => emit("mcp-server:started", 51234));
      expect(result.current.running).toBe(true);

      let returned: unknown;
      await act(async () => {
        release(STOPPED);
        returned = await refreshing;
      });
      expect(result.current.running).toBe(true);
      expect(result.current.port).toBe(51234);
      // The caller sees what the hook now knows, not the snapshot it dropped:
      // useMcpHealthCheck reads this value to decide "bridge not running".
      expect(returned).toEqual({ running: true, port: 51234 });
    });

    it("a stopped event that lands while start() is in flight is not overwritten by the start's older snapshot", async () => {
      let release: (status: unknown) => void = () => {};
      invokeMock.mockImplementation((cmd) =>
        cmd === "mcp_bridge_start"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(STOPPED),
      );
      const { result } = await mount();

      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.start();
      });
      await waitFor(() => expect(result.current.loading).toBe(true));
      // Another window stopped the bridge after Rust answered this start.
      act(() => emit("mcp-server:stopped"));

      await act(async () => {
        release(RUNNING);
        await pending;
      });
      expect(result.current.running).toBe(false);
      expect(result.current.port).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();

      // Had Rust in fact processed the start AFTER that stop, its own started
      // event follows on the same channel and restores the truth — the
      // snapshot was never needed.
      act(() => emit("mcp-server:started", 51234));
      expect(result.current.running).toBe(true);
      expect(result.current.port).toBe(51234);
    });

    // The premise the whole "events beat snapshots" rule rests on, made
    // explicit (audit #382, round 3). `mcp_server.rs` emits BEFORE each
    // command returns — `announce_started` sits on the last line of
    // `mcp_bridge_start`, `mcp_bridge_stop` emits before its `Ok` — and both
    // go out on ONE ordered channel. So the last event delivered is the
    // freshest thing Rust has announced, and a delayed event that overwrites a
    // newer command result is followed by that command's OWN event. The state
    // converges without any version on the wire; what it costs is a transient,
    // which the second assertion below records rather than hides.
    it("converges on the LAST event delivered, whatever a command answered in between", async () => {
      const { result } = await mount();
      routeInvoke({ status: STOPPED, start: RUNNING });

      await act(async () => {
        await result.current.start();
      });
      expect(result.current.running).toBe(true);

      // A `stopped` emitted BEFORE that start, delivered after its response.
      act(() => emit("mcp-server:stopped"));
      // The transient: for the length of the event channel's delivery lag the
      // hook shows the older announcement. Nothing frontend-side can tell it
      // is older — that would need a sequence number on the event.
      expect(result.current.running).toBe(false);

      // The start's own event is queued behind it on the same channel.
      act(() => emit("mcp-server:started", 51234));
      expect(result.current.running).toBe(true);
      expect(result.current.port).toBe(51234);
    });
  });

  describe("refresh()", () => {
    it("returns the fetched status and applies it", async () => {
      const { result } = await mount();
      routeInvoke({ status: RUNNING });

      let status: unknown;
      await act(async () => {
        status = await result.current.refresh();
      });

      expect(status).toEqual(RUNNING);
      expect(result.current.running).toBe(true);
      expect(result.current.port).toBe(51234);
    });

    it("returns null on failure without throwing, and records the message", async () => {
      const { result } = await mount();
      invokeMock.mockRejectedValueOnce(new Error("status unavailable"));

      let status: unknown = "unset";
      await act(async () => {
        status = await result.current.refresh();
      });

      expect(status).toBeNull();
      expect(result.current.error).toBe("status unavailable");
    });
  });

  describe("status events from Rust", () => {
    it("mcp-server:started flips `running` on and clears a stale error", async () => {
      invokeMock.mockImplementation((cmd) =>
        cmd === "mcp_server_status"
          ? Promise.reject(new Error("bridge state poisoned"))
          : Promise.resolve(STOPPED),
      );
      const { result } = await mount();
      await waitFor(() => expect(result.current.error).toBe("bridge state poisoned"));

      // mcp_server.rs: `app.emit("mcp-server:started", actual_port)`.
      act(() => emit("mcp-server:started", 51234));

      expect(result.current.running).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it("mcp-server:started adopts the port Rust emits, so an auto-started bridge reports its port before the next refresh", async () => {
      const { result } = await mount();
      expect(result.current.port).toBeNull();

      act(() => emit("mcp-server:started", 51234));

      expect(result.current.running).toBe(true);
      expect(result.current.port).toBe(51234);
    });

    // Audit #749 — `{ running: true, port: null }` contradicts the interface
    // ("null if not running"), and the panel shows it as a live bridge with no
    // address. The event's `running` claim is still adopted (it is the freshest
    // thing Rust announced); the PORT is re-asked instead of left unknown.
    it("mcp-server:started with a malformed payload still flips `running` and leaves the port unknown", async () => {
      const { result } = await mount();
      act(() => emit("mcp-server:started", "not-a-port"));
      expect(result.current.running).toBe(true);
      expect(result.current.port).toBeNull();
    });

    it("re-asks the backend when the started payload is not a usable port", async () => {
      const { result } = await mount();
      expect(result.current.port).toBeNull();
      const statusCallsBefore = commandsSent().filter((c) => c === "mcp_server_status").length;
      // The bridge really is up; only the event's payload was unreadable.
      routeInvoke({ status: RUNNING });

      act(() => emit("mcp-server:started", "not-a-port"));

      await waitFor(() => expect(result.current.port).toBe(51234));
      expect(commandsSent().filter((c) => c === "mcp_server_status").length).toBe(
        statusCallsBefore + 1,
      );
    });

    it.each([[0], [-1], [3.5], [70000], [NaN]])(
      "treats %j as no port at all",
      async (payload) => {
        const { result } = await mount();

        act(() => emit("mcp-server:started", payload));

        expect(result.current.running).toBe(true);
        expect(result.current.port).toBeNull();
      },
    );

    it("does not re-ask when the payload is a real port", async () => {
      const { result } = await mount();
      const statusCallsBefore = commandsSent().filter((c) => c === "mcp_server_status").length;

      act(() => emit("mcp-server:started", 51234));

      expect(result.current.port).toBe(51234);
      await act(async () => {});
      expect(commandsSent().filter((c) => c === "mcp_server_status").length).toBe(
        statusCallsBefore,
      );
    });

    it("mcp-server:stopped flips `running` off", async () => {
      routeInvoke({ status: RUNNING });
      const { result } = await mount();
      await waitFor(() => expect(result.current.running).toBe(true));

      // mcp_server.rs: `app.emit("mcp-server:stopped", ())`.
      act(() => emit("mcp-server:stopped"));

      expect(result.current.running).toBe(false);
    });

    it("mcp-server:stopped clears the port — null when not running, as the interface says", async () => {
      routeInvoke({ status: RUNNING });
      const { result } = await mount();
      await waitFor(() => expect(result.current.port).toBe(51234));

      act(() => emit("mcp-server:stopped"));

      expect(result.current.running).toBe(false);
      expect(result.current.port).toBeNull();
    });

    // Audit #385 — one event policy: an authoritative transition from Rust
    // supersedes the last operation's failure, whichever direction it goes.
    it("mcp-server:stopped clears a stale error, as started does", async () => {
      routeInvoke({ status: RUNNING });
      const { result } = await mount();
      await waitFor(() => expect(result.current.running).toBe(true));
      invokeMock.mockRejectedValueOnce(new Error("shutdown timed out"));
      await act(async () => {
        try {
          await result.current.stop();
        } catch {
          /* recorded in `error`, asserted below */
        }
      });
      expect(result.current.error).toBe("shutdown timed out");

      act(() => emit("mcp-server:stopped"));

      expect(result.current.running).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // Audit #748 — the error was cleared when a command was ENQUEUED, never when
  // one succeeded. Two clicks in the same tick both clear up front; the first
  // command then fails and the second succeeds, and its success left the
  // earlier failure's message on screen with nothing to dismiss it.
  describe("a later success clears an earlier command's error (#748)", () => {
    it("does not leave a failed start's message over a successful stop", async () => {
      invokeMock.mockImplementation((cmd) => {
        switch (cmd) {
          case "mcp_server_status":
            return Promise.resolve(STOPPED);
          case "mcp_bridge_start":
            return Promise.reject(new Error("port in use"));
          case "mcp_bridge_stop":
            return Promise.resolve(STOPPED);
          default:
            return Promise.reject(new Error(`unexpected command ${cmd}`));
        }
      });
      const { result } = await mount();

      // Both are queued before either settles — the enqueue-time clear for the
      // stop therefore happens BEFORE the start's failure is recorded.
      await act(async () => {
        const started = result.current.start().catch(() => undefined);
        const stopped = result.current.stop();
        await Promise.all([started, stopped]);
      });

      expect(result.current.error).toBeNull();
      expect(result.current.running).toBe(false);
    });
  });

  describe("unmount", () => {
    it("removes every listener, so a later event cannot reach a dead hook", async () => {
      const { unmount } = await mount();
      expect(listenerCount("mcp-server:started")).toBe(1);

      unmount();
      // safeUnlistenAsync resolves the listen() promise on a microtask.
      await act(async () => {});

      expect(listenerCount("mcp-server:started")).toBe(0);
      expect(listenerCount("mcp-server:stopped")).toBe(0);
      expect(listenerCount("mcp-server:sidecar-terminated")).toBe(0);
      expect(() => emit("mcp-server:started", 1)).not.toThrow();
    });
  });
});
