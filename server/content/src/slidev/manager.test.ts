// C2 — Slidev supervisor: reuse-per-deck, sub-port tracking, isolated stop.
// WI-1.5 — Slidev supervisor child start/stop lifecycle.
import { describe, it, expect, vi } from "vitest";
import { SlidevManager } from "./manager";
import type { SlidevModule } from "./server";

function fakeSlidev(): { mod: SlidevModule; created: number; closed: number } {
  const state = { created: 0, closed: 0 };
  const mod: SlidevModule = {
    resolveOptions: vi.fn().mockResolvedValue({}),
    createServer: vi.fn().mockImplementation(async () => {
      state.created++;
      const port = 4000 + state.created;
      return {
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockImplementation(async () => {
          state.closed++;
        }),
        httpServer: { address: () => ({ port }) },
        config: { server: { port } },
      };
    }),
  };
  return { mod, get created() { return state.created; }, get closed() { return state.closed; } } as never;
}

describe("SlidevManager", () => {
  it("starts a server for a deck and reuses it", async () => {
    const fake = fakeSlidev();
    const mgr = new SlidevManager(async () => fake.mod);
    const a = await mgr.start("/decks/talk.md");
    const b = await mgr.start("/decks/talk.md");
    expect(a.subPort).toBe(b.subPort);
    expect(fake.created).toBe(1); // reused, not re-created
    expect(mgr.count()).toBe(1);
  });

  it("tracks separate decks independently", async () => {
    const fake = fakeSlidev();
    const mgr = new SlidevManager(async () => fake.mod);
    const a = await mgr.start("/a.md");
    const b = await mgr.start("/b.md");
    expect(a.subPort).not.toBe(b.subPort);
    expect(mgr.count()).toBe(2);
  });

  it("stop closes one deck without affecting others", async () => {
    const fake = fakeSlidev();
    const mgr = new SlidevManager(async () => fake.mod);
    await mgr.start("/a.md");
    await mgr.start("/b.md");
    await mgr.stop("/a.md");
    expect(mgr.count()).toBe(1);
    expect(mgr.subPort("/b.md")).toBeDefined();
    expect(mgr.subPort("/a.md")).toBeUndefined();
  });

  it("stopAll closes every server", async () => {
    const fake = fakeSlidev();
    const mgr = new SlidevManager(async () => fake.mod);
    await mgr.start("/a.md");
    await mgr.start("/b.md");
    await mgr.stopAll();
    expect(mgr.count()).toBe(0);
    expect(fake.closed).toBe(2);
  });

  // ── audit 20260906, MCP-C01: a failed start must not kill the process ──
  //
  // Startup bookkeeping used to live on a promise DERIVED from the startup
  // one (`pending.then(...).finally(...)`). `start()` awaited the original, so
  // the caller saw the failure and the route returned 500 — but the derived
  // chain rejected with nobody observing it, and Node terminates the process
  // on an unhandled rejection. One malformed deck took down the knowledge-base
  // server and every preview sharing it.
  describe("a failed startup", () => {
    /** A module whose server creation always rejects. */
    function brokenSlidev(): SlidevModule {
      return {
        resolveOptions: vi.fn().mockResolvedValue({}),
        createServer: vi.fn().mockRejectedValue(new Error("invalid deck")),
      } as never;
    }

    it("rejects to the caller", async () => {
      const mgr = new SlidevManager(async () => brokenSlidev());

      await expect(mgr.start("/bad.md")).rejects.toThrow("invalid deck");
    });

    // The property that matters, and the one a `.then()` chain broke: NO
    // promise is left unobserved. An unhandled rejection here exits the
    // process, so this is asserted by watching for the event rather than by
    // inspecting the implementation.
    it("leaves no unobserved rejection behind", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const mgr = new SlidevManager(async () => brokenSlidev());
        await mgr.start("/bad.md").catch(() => {});
        // Let the microtask queue drain so any detached chain would surface.
        await new Promise((resolve) => setTimeout(resolve, 10));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandled).toEqual([]);
    });

    it("allows a retry after the failure clears", async () => {
      let broken = true;
      const good = fakeSlidev();
      const mgr = new SlidevManager(async () =>
        broken ? brokenSlidev() : good.mod,
      );

      await expect(mgr.start("/deck.md")).rejects.toThrow();
      broken = false;

      const handle = await mgr.start("/deck.md");
      expect(handle.subPort).toBeDefined();
      expect(mgr.count()).toBe(1);
    });
  });

  // ── audit 20260906, MCP-C04: shutdown must own in-flight starts ──
  describe("a start still in flight when shutdown arrives", () => {
    /** A module whose server creation blocks until `release()` is called. */
    function gatedSlidev() {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const state = { created: 0, closed: 0 };
      const mod = {
        resolveOptions: vi.fn().mockResolvedValue({}),
        createServer: vi.fn().mockImplementation(async () => {
          await gate;
          state.created++;
          return {
            listen: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockImplementation(async () => {
              state.closed++;
            }),
            httpServer: { address: () => ({ port: 4321 }) },
            config: { server: { port: 4321 } },
          };
        }),
      } as never as SlidevModule;
      return { mod, release, state };
    }

    // `stopAll` snapshotted only COMPLETED servers, so it returned
    // {count: 0} and the pending startup then inserted itself: an unproxied
    // server running past the shutdown that was supposed to end it.
    it("does not register a server that finishes after stopAll", async () => {
      const gated = gatedSlidev();
      const mgr = new SlidevManager(async () => gated.mod);

      const pending = mgr.start("/slow.md").catch(() => {});
      const shutdown = mgr.stopAll();
      gated.release();
      await Promise.all([pending, shutdown]);

      expect(mgr.count()).toBe(0);
      expect(mgr.subPort("/slow.md")).toBeUndefined();
    });

    it("closes the late server instead of leaking it", async () => {
      const gated = gatedSlidev();
      const mgr = new SlidevManager(async () => gated.mod);

      const pending = mgr.start("/slow.md").catch(() => {});
      const shutdown = mgr.stopAll();
      gated.release();
      await Promise.all([pending, shutdown]);

      expect(gated.state.created).toBe(1);
      expect(gated.state.closed).toBe(1);
    });

    it("stop(deck) also owns a start in flight for that deck", async () => {
      const gated = gatedSlidev();
      const mgr = new SlidevManager(async () => gated.mod);

      const pending = mgr.start("/slow.md").catch(() => {});
      const stopped = mgr.stop("/slow.md");
      gated.release();
      await Promise.all([pending, stopped]);

      expect(mgr.count()).toBe(0);
      expect(gated.state.closed).toBe(1);
    });

    it("stays usable after a shutdown", async () => {
      const gated = gatedSlidev();
      const mgr = new SlidevManager(async () => gated.mod);
      const pending = mgr.start("/slow.md").catch(() => {});
      const shutdown = mgr.stopAll();
      gated.release();
      await Promise.all([pending, shutdown]);

      const fresh = fakeSlidev();
      const restarted = new SlidevManager(async () => fresh.mod);
      await restarted.start("/a.md");
      expect(restarted.count()).toBe(1);
    });
  });
});
