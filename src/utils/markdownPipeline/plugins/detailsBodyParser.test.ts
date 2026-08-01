/**
 * The injection seam's contract: wired, or a NAMED failure.
 *
 * A `<details>` body parsed with the wrong plugin set is a correctness bug that
 * looks like working software — the body still parses, just under a dialect
 * nobody chose. So an unwired parser throws by name rather than falling back to
 * a default, and this pins that rather than trusting it.
 *
 * @coordinates-with utils/markdownPipeline/plugins/detailsBodyParser.ts
 * @coordinates-with utils/markdownPipeline/dialect.ts — the only production wirer
 * @module utils/markdownPipeline/plugins/detailsBodyParser.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A fresh module instance, so the module-level wiring starts empty.
 *
 * `resetModules` in beforeEach is what makes each import fresh; a query-string
 * suffix would work too but vite warns that the extension must be static.
 */
async function freshModule() {
  return (await import("./detailsBodyParser")) as typeof import("./detailsBodyParser");
}

beforeEach(() => {
  vi.resetModules();
});

describe("unwired", () => {
  it("throws a message naming the module that wires it", async () => {
    const mod = await freshModule();
    expect(() => mod.getDetailsBodyParser()).toThrow(/dialect/);
  });

  it("says the parser is not wired, not something incidental", async () => {
    const mod = await freshModule();
    expect(() => mod.getDetailsBodyParser()).toThrow(/not wired/);
  });
});

describe("wired", () => {
  it("returns what the factory produces", async () => {
    const mod = await freshModule();
    const processor = { parse: () => ({}), runSync: () => ({}) };
    mod.setDetailsBodyParser(() => processor);

    expect(mod.getDetailsBodyParser()).toBe(processor);
  });

  it("calls the factory PER REQUEST, not once at wiring time", async () => {
    // Lazy by design: `dialect.ts` wires at module init, before every
    // descriptor is necessarily evaluated. Building eagerly there would
    // capture a half-built chain.
    const mod = await freshModule();
    const factory = vi.fn(() => ({ parse: () => ({}), runSync: () => ({}) }));
    mod.setDetailsBodyParser(factory);

    expect(factory).not.toHaveBeenCalled();
    mod.getDetailsBodyParser();
    mod.getDetailsBodyParser();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("the last wiring wins, so a test can override production's", async () => {
    const mod = await freshModule();
    const first = { parse: () => ({}), runSync: () => ({}) };
    const second = { parse: () => ({}), runSync: () => ({}) };
    mod.setDetailsBodyParser(() => first);
    mod.setDetailsBodyParser(() => second);

    expect(mod.getDetailsBodyParser()).toBe(second);
  });
});

describe("production wiring", () => {
  it("importing the dialect is sufficient — no explicit setup needed", async () => {
    vi.resetModules();
    await import("../dialect");
    const mod = await import("./detailsBodyParser");

    expect(() => mod.getDetailsBodyParser()).not.toThrow();
  });

  it("the wired body processor excludes remarkDetailsBlock (recursion guard)", async () => {
    vi.resetModules();
    await import("../dialect");
    const mod = await import("./detailsBodyParser");

    const processor = mod.getDetailsBodyParser() as unknown as {
      attachers: [{ name?: string }][];
    };
    const names = processor.attachers.map(([fn]) => fn.name);
    expect(names).not.toContain("remarkDetailsBlock");
    expect(names).toContain("remarkParse");
  });
});
