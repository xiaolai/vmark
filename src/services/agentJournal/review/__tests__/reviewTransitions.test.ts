// @vitest-environment node
// WI-AL2.3 — R9: the TypeScript review state machine is the one transitions.json pins (and the Rust matrix equals): every event's from → to map equal, the same seven states and the same user and capture events, and no forbidden edge (reverted → conflicted) present; an absent entry has no next state
import { describe, it, expect } from "vitest";

import golden from "@/test/fixtures/agentJournal/transitions.json";
import { HUNK_STATES, REVIEW_EVENTS, REVIEW_TRANSITIONS, nextReviewState } from "../reviewTransitions";

describe("reviewTransitions", () => {
  it("is the transitions.json matrix, edge for edge", () => {
    expect(REVIEW_TRANSITIONS).toEqual(golden.transitions);
  });

  it("names the same states and events", () => {
    expect([...HUNK_STATES]).toEqual(golden.states);
    expect([...REVIEW_EVENTS]).toEqual([...golden.userEvents, ...golden.captureEvents]);
  });

  it.each(golden.forbidden)("has no forbidden edge %j", ({ from, to }) => {
    for (const event of REVIEW_EVENTS) expect(nextReviewState(event, from as (typeof HUNK_STATES)[number])).not.toBe(to);
  });

  it("reads a present entry and answers undefined for an absent one", () => {
    expect(nextReviewState("keep", "conflicted")).toBe("kept");
    expect(nextReviewState("unkeep", "pending")).toBeUndefined();
    expect(nextReviewState("clearReviewed", "settled")).toBeUndefined();
  });
});
