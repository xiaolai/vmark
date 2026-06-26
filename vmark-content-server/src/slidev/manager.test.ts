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
});
