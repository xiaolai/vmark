// WI-#4 — static if-condition evaluator. Subset of GHA expression
// language: literal comparisons (==, !=), && / ||, !, parens, single-
// quoted strings, basic property access on a simulated context.

import { describe, it, expect } from "vitest";
import { evaluateIf, type SimContext } from "./staticIf";

const PUSH_MAIN: SimContext = {
  github: {
    event_name: "push",
    ref: "refs/heads/main",
    actor: "alice",
  },
};

const PR_FORK: SimContext = {
  github: {
    event_name: "pull_request",
    ref: "refs/pull/42/merge",
    actor: "bob",
  },
};

describe("evaluateIf", () => {
  it("returns 'unknown' for empty / undefined input", () => {
    expect(evaluateIf(undefined, PUSH_MAIN)).toBe("unknown");
    expect(evaluateIf("", PUSH_MAIN)).toBe("unknown");
  });

  it("strips ${{ }} wrapping", () => {
    expect(evaluateIf("${{ true }}", PUSH_MAIN)).toBe(true);
  });

  it("evaluates literal true / false", () => {
    expect(evaluateIf("true", PUSH_MAIN)).toBe(true);
    expect(evaluateIf("false", PUSH_MAIN)).toBe(false);
  });

  it("evaluates equality on github.event_name", () => {
    expect(evaluateIf("github.event_name == 'push'", PUSH_MAIN)).toBe(true);
    expect(evaluateIf("github.event_name == 'push'", PR_FORK)).toBe(false);
  });

  it("evaluates inequality", () => {
    expect(evaluateIf("github.event_name != 'push'", PUSH_MAIN)).toBe(false);
    expect(evaluateIf("github.event_name != 'push'", PR_FORK)).toBe(true);
  });

  it("evaluates && / ||", () => {
    expect(
      evaluateIf(
        "github.event_name == 'push' && github.ref == 'refs/heads/main'",
        PUSH_MAIN,
      ),
    ).toBe(true);
    expect(
      evaluateIf(
        "github.event_name == 'pull_request' || github.event_name == 'push'",
        PUSH_MAIN,
      ),
    ).toBe(true);
  });

  it("evaluates !", () => {
    expect(evaluateIf("!(github.event_name == 'push')", PUSH_MAIN)).toBe(false);
  });

  it("returns 'unknown' for expressions involving secrets / functions", () => {
    expect(evaluateIf("contains(github.ref, 'main')", PUSH_MAIN)).toBe(
      "unknown",
    );
    expect(evaluateIf("secrets.TOKEN != ''", PUSH_MAIN)).toBe("unknown");
  });

  it("returns 'unknown' for unknown property access", () => {
    expect(evaluateIf("steps.foo.outputs.bar == '1'", PUSH_MAIN)).toBe(
      "unknown",
    );
  });

  it("returns 'unknown' on parse failure", () => {
    expect(evaluateIf("github.event_name ==", PUSH_MAIN)).toBe("unknown");
    expect(evaluateIf("(((", PUSH_MAIN)).toBe("unknown");
  });

  it("returns 'unknown' for unterminated string", () => {
    expect(evaluateIf("github.event_name == 'oops", PUSH_MAIN)).toBe(
      "unknown",
    );
  });

  it("returns 'unknown' when ${{ }} wraps an empty body", () => {
    expect(evaluateIf("${{ }}", PUSH_MAIN)).toBe("unknown");
  });

  it("evaluates parenthesized expressions", () => {
    expect(
      evaluateIf("(github.event_name == 'push')", PUSH_MAIN),
    ).toBe(true);
  });

  it("&& with unknown right side returns 'unknown' even if left is false (no short-circuit)", () => {
    // Documented limitation: parser fully evaluates both sides. Function
    // calls in the right operand throw UnknownError, propagating up
    // before the short-circuit logic runs. Safe-by-default; user gets
    // an honest "I don't know" rather than a confident wrong answer.
    expect(
      evaluateIf("false && contains(x, 'y')", PUSH_MAIN),
    ).toBe("unknown");
  });

  it("&& with both literals evaluates correctly", () => {
    expect(evaluateIf("false && true", PUSH_MAIN)).toBe(false);
    expect(evaluateIf("true && true", PUSH_MAIN)).toBe(true);
  });

  it("rejects bare strings as conditions", () => {
    expect(evaluateIf("'hello'", PUSH_MAIN)).toBe("unknown");
  });

  it("returns 'unknown' for non-github root identifier", () => {
    expect(evaluateIf("env.X == 'a'", PUSH_MAIN)).toBe("unknown");
  });

  it("returns 'unknown' for too-deep github path (more than 2 levels)", () => {
    expect(
      evaluateIf("github.event.pull_request.number == 1", PR_FORK),
    ).toBe("unknown");
  });
});
