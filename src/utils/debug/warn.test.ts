import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { browserWarn, hotExitWarn, cjkFmtWarn } from "./warn";

// The warn loggers were previously excluded from coverage wholesale, which hid
// that browserWarn (embedded browser: driver gate, grants, surface) had no
// direct test. These assert the exported loggers still tag + forward + never
// throw — a real regression net over the createWarnLogger factory wiring.

describe("warn loggers", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("browserWarn prefixes with [Browser] and forwards args", () => {
    browserWarn("driver gate closed", { tabId: "t1" });
    expect(warnSpy).toHaveBeenCalledWith("[Browser]", "driver gate closed", { tabId: "t1" });
  });

  it("browserWarn does not throw with no arguments", () => {
    expect(() => browserWarn()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith("[Browser]");
  });

  it("distinct loggers keep distinct prefixes", () => {
    hotExitWarn("a");
    cjkFmtWarn("b");
    expect(warnSpy).toHaveBeenNthCalledWith(1, "[HotExit]", "a");
    expect(warnSpy).toHaveBeenNthCalledWith(2, "[CJK Formatter]", "b");
  });
});
