// Phase 6 — Slidev wrapper wiring (module injected; live runtime covered by S0.2).
import { describe, it, expect, vi } from "vitest";
import { startSlidevServer, type SlidevModule } from "./server";

function fakeSlidev(boundPort: number): SlidevModule {
  const close = vi.fn().mockResolvedValue(undefined);
  return {
    resolveOptions: vi.fn().mockResolvedValue({ entry: "x" }),
    createServer: vi.fn().mockResolvedValue({
      listen: vi.fn().mockResolvedValue(undefined),
      close,
      httpServer: { address: () => ({ port: boundPort }) },
      config: { server: { port: boundPort } },
    }),
  };
}

describe("startSlidevServer", () => {
  it("resolves options for the given entry and binds loopback", async () => {
    const mod = fakeSlidev(4567);
    const running = await startSlidevServer({ entry: "/abs/slides.md", loadSlidev: async () => mod });
    expect(mod.resolveOptions).toHaveBeenCalledWith({ entry: "/abs/slides.md" }, "dev");
    expect(running.port).toBe(4567);
    expect(running.url).toBe("http://127.0.0.1:4567");
  });

  it("passes loopback host + silent log to createServer", async () => {
    const mod = fakeSlidev(3030);
    await startSlidevServer({ entry: "/abs/d.md", port: 3030, loadSlidev: async () => mod });
    const call = (mod.createServer as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call.server).toMatchObject({ host: "127.0.0.1", port: 3030 });
    expect(call.logLevel).toBe("silent");
  });

  it("closes the underlying server", async () => {
    const mod = fakeSlidev(5000);
    const running = await startSlidevServer({ entry: "/d.md", loadSlidev: async () => mod });
    await running.close();
    // createServer's returned close should have been invoked.
    const created = await (mod.createServer as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(created.close).toHaveBeenCalled();
  });
});
