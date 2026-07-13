// Step write-ness classifier — bridges the parsed IR to the engine's write flag (WI-4.2).
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-4.2 (R8a)
import { describe, expect, it } from "vitest";
import { STEP_KINDS, type StepKind, type WorkflowStep } from "./types";
import { stepWrites, toEngineStep } from "./classify";

function mk(kind: StepKind, text = "do the thing"): WorkflowStep {
  return { index: 1, kind, text, line: 1 };
}

describe("stepWrites", () => {
  it("classifies extract as a read — a reader pulls data, never submits", () => {
    expect(stepWrites(mk("extract"))).toBe(false);
  });

  it("classifies confirm as a read — a human gate pauses, never mutates", () => {
    expect(stepWrites(mk("confirm"))).toBe(false);
  });

  it.each(["api", "action", "goal"] as StepKind[])(
    "fail-safe: classifies an undeclared %s step as a write",
    (kind) => {
      // Ambiguous tiers default to write. Under R8a a write never auto-retries or
      // auto-escalates, so this default is the safe direction — it can never cause
      // the double-post that misclassifying a write as a read would.
      expect(stepWrites(mk(kind))).toBe(true);
    },
  );

  it("classifies every known step kind as a boolean (exhaustive, no throw)", () => {
    for (const kind of STEP_KINDS) {
      expect(typeof stepWrites(mk(kind))).toBe("boolean");
    }
  });

  it("ignores step text — classification is structural, never a keyword guess", () => {
    // The dangerous heuristic would read "Publish" as a write; an extract step that
    // happens to mention publishing is still structurally a read. We never inspect text.
    expect(stepWrites(mk("extract", "Publish the draft"))).toBe(false);
    expect(stepWrites(mk("goal", "read the article title"))).toBe(true);
  });
});

describe("toEngineStep", () => {
  it("bridges a parsed step to the engine's {id, write} shape", () => {
    expect(toEngineStep({ index: 3, kind: "goal", text: "publish", line: 9 })).toEqual({
      id: "step-3",
      write: true,
      retryable: true,
    });
  });

  it("marks an extract step as a non-writing engine step", () => {
    expect(toEngineStep({ index: 1, kind: "extract", text: "read", line: 1 })).toEqual({
      id: "step-1",
      write: false,
      retryable: true,
    });
  });

  it("marks a confirm step NON-RETRYABLE — a human gate blocks, it is never re-asked", () => {
    // Plan WI-4.2: "`confirm` blocks regardless of standing grants". A declined or
    // failed confirmation must pause the run, not loop the prompt back at the human.
    expect(toEngineStep({ index: 2, kind: "confirm", text: "ok?", line: 4 })).toEqual({
      id: "step-2",
      write: false,
      retryable: false,
    });
  });

  it.each(["api", "action", "goal", "extract"] as StepKind[])(
    "leaves a %s step retryable (the engine's bounded retry still applies)",
    (kind) => {
      expect(toEngineStep(mk(kind)).retryable).toBe(true);
    },
  );

  it("derives a stable per-index id", () => {
    expect(toEngineStep(mk("action")).id).toBe("step-1");
    expect(toEngineStep({ index: 12, kind: "api", text: "x", line: 3 }).id).toBe("step-12");
  });
});
