/**
 * Tests for the dev-box disk advisory.
 *
 * The property under test is that this thing is ADVISORY: it must never block,
 * never throw, and never fire on a measurement it could not actually take.
 * Every path that cannot produce a trustworthy number returns null.
 *
 * @coordinates-with scripts/dev-disk.mjs
 * @module scripts/dev-disk.test
 */
import { describe, it, expect } from "vitest";
import { WARN_BYTES, formatBytes, diskWarning, measureDirBytes } from "./dev-disk.mjs";

const GIB = 1024 ** 3;

describe("WARN_BYTES", () => {
  it("is 40 GiB", () => {
    expect(WARN_BYTES).toBe(40 * GIB);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KiB"],
    [1536, "1.5 KiB"],
    [5 * 1024 ** 2, "5.0 MiB"],
    [149 * GIB, "149.0 GiB"],
    [2 * 1024 ** 4, "2.0 TiB"],
  ])("%i -> %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("diskWarning", () => {
  it("says nothing below the threshold", () => {
    expect(diskWarning(39 * GIB)).toBeNull();
  });

  it("says nothing exactly at the threshold minus a byte", () => {
    expect(diskWarning(WARN_BYTES - 1)).toBeNull();
  });

  it("warns at the threshold", () => {
    expect(diskWarning(WARN_BYTES)).toContain("40.0 GiB");
  });

  it("names the measured size and the command that fixes it", () => {
    const msg = diskWarning(149 * GIB);
    expect(msg).toContain("149.0 GiB");
    expect(msg).toContain("pnpm clean:dev");
  });

  it("explains that the growth is dependency churn, not releases", () => {
    // The whole reason this exists: the obvious hypothesis ("release builds
    // pile up") is wrong here — releases are built in CI and never touch this
    // machine. A warning that does not say so invites the wrong fix.
    const msg = diskWarning(149 * GIB);
    expect(msg).toMatch(/no garbage collector|never reclaim/i);
  });

  it("honours a custom threshold", () => {
    expect(diskWarning(2 * GIB, { threshold: 1 * GIB })).toContain("2.0 GiB");
    expect(diskWarning(2 * GIB, { threshold: 3 * GIB })).toBeNull();
  });

  // Fail-open paths. A measurement that did not happen must not produce a
  // warning — a bogus "0 B" or "NaN" advisory trains you to ignore the real one.
  it.each([[null], [undefined], [NaN], [Infinity], [-1], ["149"]])(
    "returns null for a non-measurement (%s)",
    (bytes) => {
      expect(diskWarning(bytes)).toBeNull();
    },
  );
});

describe("measureDirBytes", () => {
  const runOk = (kib) => () => ({ status: 0, stdout: `${kib}\t/some/path\n` });

  it("parses `du -sk` output into bytes", () => {
    expect(measureDirBytes("/x", { existsFn: () => true, runFn: runOk(1024) })).toBe(1024 * 1024);
  });

  it("returns null when the directory does not exist", () => {
    // Nothing to warn about, and `du` on a missing path is a non-zero exit we
    // would otherwise have to distinguish from a real failure.
    let called = false;
    const runFn = () => {
      called = true;
      return runOk(999)();
    };
    expect(measureDirBytes("/x", { existsFn: () => false, runFn })).toBeNull();
    expect(called, "du must not be spawned for a missing directory").toBe(false);
  });

  it("returns null when du exits non-zero", () => {
    expect(
      measureDirBytes("/x", { existsFn: () => true, runFn: () => ({ status: 1, stdout: "" }) }),
    ).toBeNull();
  });

  it("returns null when du times out", () => {
    // spawnSync reports a timeout as status null + an error. The bound exists
    // so a slow filesystem cannot stall `pnpm tauri:dev`; a stalled probe must
    // read as "no measurement", never as "small".
    expect(
      measureDirBytes("/x", {
        existsFn: () => true,
        runFn: () => ({ status: null, error: new Error("ETIMEDOUT"), stdout: "" }),
      }),
    ).toBeNull();
  });

  it("returns null when du prints something unparseable", () => {
    expect(
      measureDirBytes("/x", { existsFn: () => true, runFn: () => ({ status: 0, stdout: "??\n" }) }),
    ).toBeNull();
  });

  it("never throws, whatever runFn does", () => {
    expect(
      measureDirBytes("/x", {
        existsFn: () => true,
        runFn: () => {
          throw new Error("spawn failed");
        },
      }),
    ).toBeNull();
  });
});
