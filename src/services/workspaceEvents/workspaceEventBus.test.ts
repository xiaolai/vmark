import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachFsSource,
  createWorkspaceEventBus,
  type FsSourceDeps,
} from "./workspaceEventBus";
import type { SemanticWorkspaceEvent } from "./types";

const ev = (path: string): SemanticWorkspaceEvent => ({
  kind: "modified",
  path,
  rootPath: "/ws",
  selfWrite: false,
});

describe("createWorkspaceEventBus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers a published batch only after the coalesce window", () => {
    const bus = createWorkspaceEventBus(50);
    const seen: SemanticWorkspaceEvent[][] = [];
    bus.subscribe((batch) => seen.push(batch));

    bus.publish([ev("/ws/a")]);
    expect(seen).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(seen).toEqual([[ev("/ws/a")]]);
  });

  it("coalesces multiple publishes within the window into one batch (storm)", () => {
    const bus = createWorkspaceEventBus(50);
    const seen: SemanticWorkspaceEvent[][] = [];
    bus.subscribe((batch) => seen.push(batch));

    bus.publish([ev("/ws/a")]);
    vi.advanceTimersByTime(20);
    bus.publish([ev("/ws/b")]);
    vi.advanceTimersByTime(50);

    expect(seen).toHaveLength(1);
    expect(seen[0].map((e) => e.path)).toEqual(["/ws/a", "/ws/b"]);
  });

  it("ignores empty publishes", () => {
    const bus = createWorkspaceEventBus(50);
    const seen: unknown[] = [];
    bus.subscribe((b) => seen.push(b));

    bus.publish([]);
    vi.advanceTimersByTime(50);
    expect(seen).toHaveLength(0);
  });

  it("stops delivery after unsubscribe", () => {
    const bus = createWorkspaceEventBus(50);
    const seen: unknown[] = [];
    const off = bus.subscribe((b) => seen.push(b));

    off();
    bus.publish([ev("/ws/a")]);
    vi.advanceTimersByTime(50);
    expect(seen).toHaveLength(0);
  });

  it("isolates a throwing subscriber from the others", () => {
    const bus = createWorkspaceEventBus(50);
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe((b) => seen.push(b[0].path));

    bus.publish([ev("/ws/a")]);
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    expect(seen).toEqual(["/ws/a"]);
  });

  it("dispose cancels pending delivery", () => {
    const bus = createWorkspaceEventBus(50);
    const seen: unknown[] = [];
    bus.subscribe((b) => seen.push(b));

    bus.publish([ev("/ws/a")]);
    bus.dispose();
    vi.advanceTimersByTime(50);
    expect(seen).toHaveLength(0);
  });
});

describe("attachFsSource", () => {
  function fakeDeps(over: Partial<FsSourceDeps> = {}) {
    let captured: ((e: { payload: unknown }) => void) | null = null;
    const listen = vi.fn(
      async (_name: string, cb: (e: { payload: unknown }) => void) => {
        captured = cb;
        return () => {};
      },
    );
    const deps: FsSourceDeps = {
      listen: listen as unknown as FsSourceDeps["listen"],
      getRootPath: () => "/ws",
      normalizePath: (p) => p,
      hasPendingSave: () => false,
      ...over,
    };
    return { deps, listen, fire: (payload: unknown) => captured?.({ payload }) };
  }

  it("subscribes to fs:changed and returns an unlisten fn", async () => {
    const { deps, listen } = fakeDeps();
    const bus = createWorkspaceEventBus(50);
    const unlisten = await attachFsSource(bus, "main", deps);
    expect(listen).toHaveBeenCalledWith("fs:changed", expect.any(Function));
    expect(typeof unlisten).toBe("function");
  });

  it("normalizes payloads and publishes the semantic events", async () => {
    const { deps, fire } = fakeDeps();
    const bus = createWorkspaceEventBus(50);
    const publish = vi.spyOn(bus, "publish").mockImplementation(() => {});
    await attachFsSource(bus, "main", deps);

    fire({ watchId: "main", rootPath: "/ws", paths: ["/ws/a.md"], kind: "modify" });
    expect(publish).toHaveBeenCalledWith([
      { kind: "modified", path: "/ws/a.md", rootPath: "/ws", selfWrite: false },
    ]);
  });

  it("drops payloads from another window (publishes an empty list)", async () => {
    const { deps, fire } = fakeDeps();
    const bus = createWorkspaceEventBus(50);
    const publish = vi.spyOn(bus, "publish").mockImplementation(() => {});
    await attachFsSource(bus, "main", deps);

    fire({ watchId: "other", rootPath: "/ws", paths: ["/ws/a.md"], kind: "modify" });
    expect(publish).toHaveBeenCalledWith([]);
  });

  it("reads the workspace root live on each event", async () => {
    let root: string | null = null;
    const { deps, fire } = fakeDeps({ getRootPath: () => root });
    const bus = createWorkspaceEventBus(50);
    const publish = vi.spyOn(bus, "publish").mockImplementation(() => {});
    await attachFsSource(bus, "main", deps);

    fire({ watchId: "main", rootPath: "/ws", paths: ["/ws/a.md"], kind: "modify" });
    expect(publish).toHaveBeenLastCalledWith([]); // no workspace yet

    root = "/ws";
    fire({ watchId: "main", rootPath: "/ws", paths: ["/ws/a.md"], kind: "modify" });
    expect(publish).toHaveBeenLastCalledWith([
      { kind: "modified", path: "/ws/a.md", rootPath: "/ws", selfWrite: false },
    ]);
  });

  it("applies the content-suppression filter before publishing when provided", async () => {
    const { deps, fire } = fakeDeps();
    const suppress = vi.fn(async () => []); // suppress everything
    const bus = createWorkspaceEventBus(50);
    const publish = vi.spyOn(bus, "publish").mockImplementation(() => {});
    await attachFsSource(bus, "main", { ...deps, suppress });

    fire({ watchId: "main", rootPath: "/ws", paths: ["/ws/a.md"], kind: "modify" });
    await Promise.resolve();
    await Promise.resolve();

    expect(suppress).toHaveBeenCalledWith([
      { kind: "modified", path: "/ws/a.md", rootPath: "/ws", selfWrite: false },
    ]);
    expect(publish).toHaveBeenLastCalledWith([]);
  });

  it("publishes unfiltered when the suppression filter rejects (never drops)", async () => {
    const { deps, fire } = fakeDeps();
    const suppress = vi.fn(async () => {
      throw new Error("read blew up");
    });
    const bus = createWorkspaceEventBus(50);
    const publish = vi.spyOn(bus, "publish").mockImplementation(() => {});
    await attachFsSource(bus, "main", { ...deps, suppress });

    fire({ watchId: "main", rootPath: "/ws", paths: ["/ws/a.md"], kind: "modify" });
    await Promise.resolve();
    await Promise.resolve();

    expect(publish).toHaveBeenLastCalledWith([
      { kind: "modified", path: "/ws/a.md", rootPath: "/ws", selfWrite: false },
    ]);
  });
});
