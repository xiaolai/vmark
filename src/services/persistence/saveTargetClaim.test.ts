// @vitest-environment node
//
// Audit 20260906 F3 — a late autosave completion reverted a completed Save As.

import { describe, expect, it, beforeEach } from "vitest";
import {
  activateSaveTarget,
  claimSaveTarget,
  forgetSaveTarget,
  isCurrentSaveTarget,
  isSameDocument,
  reserveSaveTarget,
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

  // A tab moved out of the window and back keeps its id: the reopened document
  // must not inherit an equal claim from the closed one.
  it("never lets a closed document's claim pass for a reopened one with the same tab id", () => {
    const closed = claimSaveTarget("tab-1");
    forgetSaveTarget("tab-1");
    const reopened = claimSaveTarget("tab-1");

    expect(isCurrentSaveTarget(closed)).toBe(false);
    expect(isCurrentSaveTarget(reopened)).toBe(true);
  });

  it("tells a superseded save of the same document from a save of a closed one", () => {
    const older = claimSaveTarget("tab-1");
    claimSaveTarget("tab-1");
    expect(isSameDocument(older)).toBe(true);

    forgetSaveTarget("tab-1");
    expect(isSameDocument(older)).toBe(false);
    claimSaveTarget("tab-1");
    expect(isSameDocument(older)).toBe(false);
  });
});

// A Save As is ordered at admission but may still be refused (path guard,
// approval, overwrite). A refused request must never become the newest claim:
// it would suppress the post-save state of an earlier, successful Save As.
describe("saveTargetClaim — reservation, then activation", () => {
  it("a reservation that is never activated supersedes nothing", () => {
    const accepted = claimSaveTarget("tab-1");
    reserveSaveTarget("tab-1"); // refused before activation

    expect(isCurrentSaveTarget(accepted)).toBe(true);
  });

  it("an activated reservation becomes current", () => {
    const claim = activateSaveTarget(reserveSaveTarget("tab-1"));

    expect(isCurrentSaveTarget(claim)).toBe(true);
    expect(isSameDocument(claim)).toBe(true);
  });

  it("keeps ADMISSION order: a later-admitted request activated first is not overridden", () => {
    const first = reserveSaveTarget("tab-1");
    const second = reserveSaveTarget("tab-1");
    const secondClaim = activateSaveTarget(second);
    const firstClaim = activateSaveTarget(first);

    expect(isCurrentSaveTarget(secondClaim)).toBe(true);
    expect(isCurrentSaveTarget(firstClaim)).toBe(false);
    expect(isSameDocument(firstClaim)).toBe(true);
  });

  it("an earlier-admitted request activated after a refused later one is current", () => {
    const first = reserveSaveTarget("tab-1");
    reserveSaveTarget("tab-1"); // admitted later, then refused

    expect(isCurrentSaveTarget(activateSaveTarget(first))).toBe(true);
  });

  it("a save submitted after the reservation still supersedes it", () => {
    const reserved = reserveSaveTarget("tab-1");
    const autosave = claimSaveTarget("tab-1");
    const late = activateSaveTarget(reserved);

    expect(isCurrentSaveTarget(autosave)).toBe(true);
    expect(isCurrentSaveTarget(late)).toBe(false);
  });

  it("a reservation whose document was closed activates as a closed document's claim", () => {
    const reserved = reserveSaveTarget("tab-1");
    forgetSaveTarget("tab-1");
    claimSaveTarget("tab-1"); // the id reopened as another document
    const claim = activateSaveTarget(reserved);

    expect(isSameDocument(claim)).toBe(false);
    expect(isCurrentSaveTarget(claim)).toBe(false);
  });

  it("reserving keeps the document's incarnation, so a later claim names the same document", () => {
    const reserved = reserveSaveTarget("tab-1");
    claimSaveTarget("tab-1");

    expect(isSameDocument(activateSaveTarget(reserved))).toBe(true);
  });
});
