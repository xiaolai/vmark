import { describe, it, expect } from "vitest";
import {
  FILE_SIZE_THRESHOLDS,
  classifyFileSize,
  shouldShowProgressIndicator,
  formatFileSize,
} from "./fileSizeThresholds";

describe("classifyFileSize", () => {
  const {
    SHOW_PROGRESS_BYTES,
    SOURCE_MODE_DEFAULT_BYTES,
    WARN_BEFORE_OPEN_BYTES,
    HARD_REFUSE_BYTES,
  } = FILE_SIZE_THRESHOLDS;

  it.each([
    // [label, bytes, expectedTier]
    ["zero bytes", 0, "small"],
    ["below progress threshold", SHOW_PROGRESS_BYTES - 1, "small"],
    ["at progress threshold", SHOW_PROGRESS_BYTES, "small"],
    ["just below source-mode", SOURCE_MODE_DEFAULT_BYTES - 1, "small"],
    ["at source-mode threshold", SOURCE_MODE_DEFAULT_BYTES, "large"],
    ["just below warn threshold", WARN_BEFORE_OPEN_BYTES - 1, "large"],
    ["at warn threshold", WARN_BEFORE_OPEN_BYTES, "huge"],
    ["just below hard refuse", HARD_REFUSE_BYTES - 1, "huge"],
    ["at hard-refuse threshold", HARD_REFUSE_BYTES, "refused"],
    ["far above refuse", HARD_REFUSE_BYTES * 10, "refused"],
  ])("%s (%d bytes) → %s", (_label, bytes, tier) => {
    expect(classifyFileSize(bytes)).toBe(tier);
  });

  it("treats NaN as small", () => {
    expect(classifyFileSize(Number.NaN)).toBe("small");
  });

  it("treats negative sizes as small (caller handles read error downstream)", () => {
    expect(classifyFileSize(-1)).toBe("small");
  });

  it("treats Infinity as small (defensively)", () => {
    expect(classifyFileSize(Number.POSITIVE_INFINITY)).toBe("small");
  });
});

describe("shouldShowProgressIndicator", () => {
  const { SHOW_PROGRESS_BYTES } = FILE_SIZE_THRESHOLDS;

  it("returns false below the threshold", () => {
    expect(shouldShowProgressIndicator(0)).toBe(false);
    expect(shouldShowProgressIndicator(SHOW_PROGRESS_BYTES - 1)).toBe(false);
  });

  it("returns true at or above the threshold", () => {
    expect(shouldShowProgressIndicator(SHOW_PROGRESS_BYTES)).toBe(true);
    expect(shouldShowProgressIndicator(SHOW_PROGRESS_BYTES * 100)).toBe(true);
  });

  it("returns false for non-finite inputs", () => {
    expect(shouldShowProgressIndicator(Number.NaN)).toBe(false);
    expect(shouldShowProgressIndicator(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("formatFileSize", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1024 * 10, "10.0 KB"],
    [1024 * 100, "100 KB"],
    [1024 * 1023, "1023 KB"],
    [1024 * 1024, "1.0 MB"],
    [1024 * 1024 * 1.4, "1.4 MB"],
    [1024 * 1024 * 10, "10.0 MB"],
    [1024 * 1024 * 100, "100 MB"],
    [1024 * 1024 * 1024, "1.0 GB"],
    [1024 * 1024 * 1024 * 1.5, "1.5 GB"],
  ])("formats %d → %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  it("handles invalid inputs", () => {
    expect(formatFileSize(Number.NaN)).toBe("0 B");
    expect(formatFileSize(-42)).toBe("0 B");
  });
});
