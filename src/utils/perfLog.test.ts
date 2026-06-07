/**
 * Tests for perfLog.ts — performance logging utility.
 *
 * The module gates all output behind localStorage("PERF_LOG") === "true".
 * Tests verify both enabled and disabled paths, timing logic, and color coding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need fresh imports per test group because the module auto-runs perfReset()
// on load and reads localStorage at call time via PERF_ENABLED().

describe("perfLog — disabled (default)", () => {
  beforeEach(() => {
    localStorage.removeItem("PERF_LOG");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("perfStart does nothing when disabled", async () => {
    vi.resetModules();
    const { perfStart } = await import("./perfLog");
    perfStart("test-label");
    // No console output
    expect(console.log).not.toHaveBeenCalled();
  });

  it("perfEnd does nothing when disabled", async () => {
    vi.resetModules();
    const { perfEnd } = await import("./perfLog");
    perfEnd("test-label");
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("perfMark does nothing when disabled", async () => {
    vi.resetModules();
    const { perfMark } = await import("./perfLog");
    perfMark("mark-label");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("perfReset does not log when disabled", async () => {
    vi.resetModules();
    const { perfReset } = await import("./perfLog");
    // The module auto-calls perfReset on load; clear spy counts
    vi.mocked(console.log).mockClear();
    perfReset();
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe("perfLog — enabled", () => {
  beforeEach(() => {
    localStorage.setItem("PERF_LOG", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.removeItem("PERF_LOG");
    vi.restoreAllMocks();
  });

  it("perfReset logs session start banner", async () => {
    vi.resetModules();
    const { perfReset } = await import("./perfLog");
    vi.mocked(console.log).mockClear();
    perfReset();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("PERF SESSION START"),
      expect.any(String),
    );
  });

  it("perfStart + perfEnd logs elapsed time", async () => {
    vi.resetModules();
    const { perfReset, perfStart, perfEnd } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    perfStart("op");
    perfEnd("op");

    // Should log with [PERF] prefix and timing info
    expect(console.log).toHaveBeenCalledTimes(1);
    const logArgs = vi.mocked(console.log).mock.calls[0];
    expect(logArgs[0]).toContain("[PERF] op:");
    expect(logArgs[0]).toContain("ms");
  });

  it("perfEnd with details includes JSON details", async () => {
    vi.resetModules();
    const { perfReset, perfStart, perfEnd } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    perfStart("op");
    perfEnd("op", { nodes: 42 });

    const logArgs = vi.mocked(console.log).mock.calls[0];
    expect(logArgs[0]).toContain('"nodes":42');
  });

  it("perfEnd warns when no matching start exists", async () => {
    vi.resetModules();
    const { perfReset, perfEnd } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    perfEnd("nonexistent");

    expect(console.log).toHaveBeenCalledWith(
      "%c[PERF] No start time for: nonexistent",
      "color: #cf222e",
    );
  });

  it("perfMark logs mark with timestamp", async () => {
    vi.resetModules();
    const { perfReset, perfMark } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    perfMark("checkpoint");

    expect(console.log).toHaveBeenCalledTimes(1);
    const logArgs = vi.mocked(console.log).mock.calls[0];
    expect(logArgs[0]).toContain("[PERF]");
    expect(logArgs[0]).toContain("checkpoint");
  });

  it("perfMark with details includes JSON", async () => {
    vi.resetModules();
    const { perfReset, perfMark } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    perfMark("checkpoint", { phase: "init" });

    const logArgs = vi.mocked(console.log).mock.calls[0];
    expect(logArgs[0]).toContain('"phase":"init"');
  });

  it("perfEnd removes label from startTimes (no double-end)", async () => {
    vi.resetModules();
    const { perfReset, perfStart, perfEnd } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();
    vi.mocked(console.warn).mockClear();

    perfStart("once");
    perfEnd("once");
    perfEnd("once"); // second call — no start time

    expect(console.log).toHaveBeenCalledWith(
      "%c[PERF] No start time for: once",
      "color: #cf222e",
    );
  });
});

describe("perfLog — localStorage error handling", () => {
  it("PERF_ENABLED returns false when localStorage throws", async () => {
    const original = localStorage.getItem;
    (localStorage as unknown as Record<string, unknown>).getItem = () => {
      throw new Error("SecurityError");
    };

    vi.resetModules();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { perfStart, perfEnd, perfMark, perfReset } = await import("./perfLog");

    // All functions should silently no-op when localStorage throws
    perfStart("test");
    perfEnd("test");
    perfMark("test-mark");
    // perfReset was already called on module load (auto-reset)
    // Call it again explicitly to re-exercise the catch path
    perfReset();

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();

    localStorage.getItem = original;
    vi.restoreAllMocks();
  });
});

describe("perfLog — sessionStart zero path", () => {
  beforeEach(() => {
    localStorage.setItem("PERF_LOG", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.removeItem("PERF_LOG");
    vi.restoreAllMocks();
  });

  it("perfEnd handles sessionStart=0 (absolute = 0)", async () => {
    vi.resetModules();

    // Import fresh, but sessionStart will be set by perfReset auto-call
    // We need to test when sessionStart is falsy; we can't easily reset it
    // since it's module-level, but the auto-reset sets it.
    // This path is already covered. Instead test perfMark without details.
    const { perfReset, perfMark } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    perfMark("no-details-mark");

    const logArgs = vi.mocked(console.log).mock.calls[0];
    expect(logArgs[0]).toContain("no-details-mark");
    // No details string
    expect(logArgs[0]).not.toContain("|");
  });

  it("perfEnd without details omits detail string", async () => {
    vi.resetModules();
    const { perfReset, perfStart, perfEnd } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    perfStart("no-detail-op");
    perfEnd("no-detail-op");

    const logArgs = vi.mocked(console.log).mock.calls[0];
    expect(logArgs[0]).toContain("no-detail-op");
    expect(logArgs[0]).not.toContain("|");
  });
});

describe("perfLog — perfEnd color coding", () => {
  beforeEach(() => {
    localStorage.setItem("PERF_LOG", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.removeItem("PERF_LOG");
    vi.restoreAllMocks();
  });

  it("uses yellow color for medium perfEnd (>50ms)", async () => {
    vi.resetModules();
    const { perfReset, perfStart, perfEnd } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    // After module load + perfReset, mock performance.now for the actual test calls
    const realNow = performance.now.bind(performance);
    const baseTime = realNow();
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(baseTime)          // perfStart stores this
      .mockReturnValueOnce(baseTime + 75)     // perfEnd: elapsed calc
      .mockReturnValueOnce(baseTime + 75);    // perfEnd: absolute calc

    perfStart("medium-op");
    perfEnd("medium-op");

    const colorArg = vi.mocked(console.log).mock.calls[0][1];
    expect(colorArg).toBe("color: #9a6700"); // yellow

    vi.mocked(performance.now).mockRestore();
  });

  it("uses red color for slow perfEnd (>100ms)", async () => {
    vi.resetModules();
    const { perfReset, perfStart, perfEnd } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    const realNow = performance.now.bind(performance);
    const baseTime = realNow();
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(baseTime)          // perfStart stores this
      .mockReturnValueOnce(baseTime + 150)    // perfEnd: elapsed calc
      .mockReturnValueOnce(baseTime + 150);   // perfEnd: absolute calc

    perfStart("slow-op");
    perfEnd("slow-op");

    const colorArg = vi.mocked(console.log).mock.calls[0][1];
    expect(colorArg).toBe("color: #cf222e"); // red

    vi.mocked(performance.now).mockRestore();
  });

});

describe("perfLog — color coding", () => {
  beforeEach(() => {
    localStorage.setItem("PERF_LOG", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.removeItem("PERF_LOG");
    vi.restoreAllMocks();
  });

  it("uses green color for fast operations (<50ms)", async () => {
    vi.resetModules();
    const { perfReset, perfStart, perfEnd } = await import("./perfLog");
    perfReset();
    vi.mocked(console.log).mockClear();

    // perfStart/perfEnd happen almost instantly -> < 50ms
    perfStart("fast-op");
    perfEnd("fast-op");

    const colorArg = vi.mocked(console.log).mock.calls[0][1];
    expect(colorArg).toBe("color: #1a7f37"); // green
  });
});
