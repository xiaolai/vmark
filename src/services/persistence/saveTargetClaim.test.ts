// @vitest-environment node
//
// Audit 20260906 F3 — a late autosave completion reverted a completed Save As.

import { describe, expect, it, beforeEach } from "vitest";
import {
  claimSaveTarget,
  forgetSaveTarget,
  isCurrentSaveTarget,
  resetSaveTargetClaims,
} from "./saveTargetClaim";

beforeEach(() => {
  resetSaveTargetClaims();
});

describe("saveTargetClaim", () => {
  it("treats a lone save as current", () => {
    expect(isCurrentSaveTarget(claimSaveTarget("tab-1"))).toBe(true);
  });

  // The reported defect, as an ordering property: the autosave to the OLD path
  // is claimed first, the Save As to the NEW path second. Whichever write
  // finishes first, only the Save As may re-point the document.
  it("supersedes an earlier save once a newer one is submitted", () => {
    const autosaveToOldPath = claimSaveTarget("tab-1");
    const saveAsToNewPath = claimSaveTarget("tab-1");

    expect(isCurrentSaveTarget(autosaveToOldPath)).toBe(false);
    expect(isCurrentSaveTarget(saveAsToNewPath)).toBe(true);
  });

  // Claiming at SUBMISSION rather than completion is what makes this hold:
  // completion order is not the user's intent order.
  it("keeps the newest claim current regardless of completion order", () => {
    const first = claimSaveTarget("tab-1");
    const second = claimSaveTarget("tab-1");

    // Simulate the second write landing before the first.
    expect(isCurrentSaveTarget(second)).toBe(true);
    expect(isCurrentSaveTarget(first)).toBe(false);
    expect(isCurrentSaveTarget(second)).toBe(true);
  });

  it("keeps documents independent of each other", () => {
    const tabOne = claimSaveTarget("tab-1");
    claimSaveTarget("tab-2");
    claimSaveTarget("tab-2");

    expect(isCurrentSaveTarget(tabOne)).toBe(true);
  });

  it("stays current across repeated checks", () => {
    const claim = claimSaveTarget("tab-1");

    expect(isCurrentSaveTarget(claim)).toBe(true);
    expect(isCurrentSaveTarget(claim)).toBe(true);
  });

  it("keeps only the newest of a long run of saves", () => {
    const claims = Array.from({ length: 10 }, () => claimSaveTarget("tab-1"));

    expect(claims.slice(0, 9).every((c) => !isCurrentSaveTarget(c))).toBe(true);
    expect(isCurrentSaveTarget(claims[9])).toBe(true);
  });

  it("reports a forgotten document's outstanding claim as superseded", () => {
    const claim = claimSaveTarget("tab-1");
    forgetSaveTarget("tab-1");

    // A tab closed mid-write must not have its stores re-pointed afterwards.
    expect(isCurrentSaveTarget(claim)).toBe(false);
  });

  it("restarts numbering cleanly after a document is forgotten", () => {
    claimSaveTarget("tab-1");
    forgetSaveTarget("tab-1");

    expect(isCurrentSaveTarget(claimSaveTarget("tab-1"))).toBe(true);
  });
});
