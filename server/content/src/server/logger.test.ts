// H10 — logger emits structured JSON; noop stays silent.
import { describe, it, expect, vi, afterEach } from "vitest";
import { stderrLogger, noopLogger } from "./logger";

afterEach(() => vi.restoreAllMocks());

describe("stderrLogger", () => {
  it("emits one JSON line per level with fields", () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    stderrLogger.info("hi", { a: 1 });
    stderrLogger.warn("careful");
    stderrLogger.error("boom", { code: "EACCES" });
    expect(writes).toHaveLength(3);
    expect(JSON.parse(writes[0])).toMatchObject({ level: "info", msg: "hi", a: 1 });
    expect(JSON.parse(writes[1])).toMatchObject({ level: "warn", msg: "careful" });
    expect(JSON.parse(writes[2])).toMatchObject({ level: "error", msg: "boom", code: "EACCES" });
  });
});

describe("noopLogger", () => {
  it("writes nothing", () => {
    const spy = vi.spyOn(process.stderr, "write");
    noopLogger.info("x");
    noopLogger.warn("y");
    noopLogger.error("z");
    expect(spy).not.toHaveBeenCalled();
  });
});
