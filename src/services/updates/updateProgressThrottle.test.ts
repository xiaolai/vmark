import { describe, it, expect } from "vitest";
import { shouldWriteProgress, INDETERMINATE_STEP_BYTES } from "./updateProgressThrottle";

describe("shouldWriteProgress", () => {
  it("always writes the first tick (nothing written yet)", () => {
    expect(shouldWriteProgress(0, -1, 1000)).toBe(true);
    expect(shouldWriteProgress(123, -1, null)).toBe(true);
  });

  describe("determinate (known total) — coalesce to whole-percent steps", () => {
    it("writes when the integer percent advances", () => {
      // 0% → 1% boundary at 10 bytes of 1000.
      expect(shouldWriteProgress(10, 0, 1000)).toBe(true);
      expect(shouldWriteProgress(500, 490, 1000)).toBe(true); // 49% → 50%
    });

    it("skips sub-percent ticks", () => {
      expect(shouldWriteProgress(5, 0, 1000)).toBe(false); // still 0%
      expect(shouldWriteProgress(509, 500, 1000)).toBe(false); // both 50%
    });

    it("bounds writes to ~101 over a whole download regardless of chunk count", () => {
      const total = 10_000_000;
      let last = 0;
      let writes = 1; // the Started write
      for (let downloaded = 0; downloaded <= total; downloaded += 1000) {
        if (shouldWriteProgress(downloaded, last, total)) {
          writes++;
          last = downloaded;
        }
      }
      expect(writes).toBeLessThanOrEqual(102);
    });
  });

  describe("indeterminate (total null/0) — coalesce to ~512 KB", () => {
    it("skips until the byte step is reached", () => {
      expect(shouldWriteProgress(INDETERMINATE_STEP_BYTES - 1, 0, null)).toBe(false);
      expect(shouldWriteProgress(INDETERMINATE_STEP_BYTES, 0, null)).toBe(true);
    });

    it("treats total === 0 as indeterminate (no divide-by-zero)", () => {
      expect(shouldWriteProgress(100, 0, 0)).toBe(false);
      expect(shouldWriteProgress(INDETERMINATE_STEP_BYTES, 0, 0)).toBe(true);
    });
  });
});
