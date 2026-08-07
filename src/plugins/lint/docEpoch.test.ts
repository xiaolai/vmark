// @vitest-environment node
/**
 * Tests for the lint doc-epoch guard (docEpoch.ts).
 *
 * Codex audit: an in-flight async link-check completion must not repaint
 * stale diagnostics onto a document that changed while the check ran.
 */

import { describe, it, expect } from "vitest";
import {
  bumpLintDocEpoch,
  markLintRunStart,
  isLintRunCurrent,
} from "./docEpoch";

describe("docEpoch", () => {
  it("treats a tab with no recorded run as current (foreign callers unaffected)", () => {
    expect(isLintRunCurrent("epoch-unit-fresh")).toBe(true);
  });

  it("stays current after bumps when no run was recorded", () => {
    bumpLintDocEpoch("epoch-unit-nobody");
    bumpLintDocEpoch("epoch-unit-nobody");
    expect(isLintRunCurrent("epoch-unit-nobody")).toBe(true);
  });

  it("is current right after a run start", () => {
    markLintRunStart("epoch-unit-a");
    expect(isLintRunCurrent("epoch-unit-a")).toBe(true);
  });

  it("goes stale when the doc changes after the run started", () => {
    markLintRunStart("epoch-unit-b");
    bumpLintDocEpoch("epoch-unit-b");
    expect(isLintRunCurrent("epoch-unit-b")).toBe(false);
  });

  it("becomes current again when a new run starts after the change", () => {
    markLintRunStart("epoch-unit-c");
    bumpLintDocEpoch("epoch-unit-c");
    markLintRunStart("epoch-unit-c");
    expect(isLintRunCurrent("epoch-unit-c")).toBe(true);
  });

  it("tracks tabs independently", () => {
    markLintRunStart("epoch-unit-d1");
    markLintRunStart("epoch-unit-d2");
    bumpLintDocEpoch("epoch-unit-d1");
    expect(isLintRunCurrent("epoch-unit-d1")).toBe(false);
    expect(isLintRunCurrent("epoch-unit-d2")).toBe(true);
  });

  it("handles multiple bumps between run starts", () => {
    markLintRunStart("epoch-unit-e");
    bumpLintDocEpoch("epoch-unit-e");
    bumpLintDocEpoch("epoch-unit-e");
    bumpLintDocEpoch("epoch-unit-e");
    expect(isLintRunCurrent("epoch-unit-e")).toBe(false);
    markLintRunStart("epoch-unit-e");
    expect(isLintRunCurrent("epoch-unit-e")).toBe(true);
  });
});
