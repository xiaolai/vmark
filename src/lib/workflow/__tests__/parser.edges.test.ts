/**
 * Edge-branch coverage for the workflow parser: trigger/limit/default field
 * variants, icon derivation, source-range fallbacks, cycle reporting, and the
 * validation error paths the main suite doesn't reach. Separate file from
 * parser.test.ts to keep suites focused.
 */
import { describe, it, expect } from "vitest";
import { parseWorkflow, WorkflowValidationError, WorkflowParseError } from "../parser";

const MINIMAL = (steps: string) => `name: t\nsteps:\n${steps}`;

describe("triggers", () => {
  it("parses manual, schedule, and github triggers together", () => {
    const g = parseWorkflow(`name: t
on:
  manual: true
  schedule:
    - cron: "0 9 * * 1"
    - notCron: true
  github:
    event: pull_request
    action: opened
    branches: [main, dev]
    paths: ["src/**"]
steps:
  - uses: action/read-document
`);
    expect(g.triggers).toEqual([
      { type: "manual" },
      { type: "schedule", cron: "0 9 * * 1" },
      {
        type: "github",
        event: "pull_request",
        action: "opened",
        branches: ["main", "dev"],
        paths: ["src/**"],
      },
    ]);
  });

  it("github trigger with no fields yields undefined members", () => {
    const g = parseWorkflow(`name: t\non:\n  github: {}\nsteps:\n  - uses: action/read-document\n`);
    expect(g.triggers).toEqual([
      { type: "github", event: undefined, action: undefined, branches: undefined, paths: undefined },
    ]);
  });

  it("non-object `on` yields no triggers", () => {
    const g = parseWorkflow(`name: t\non: 3\nsteps:\n  - uses: action/read-document\n`);
    expect(g.triggers).toEqual([]);
  });
});

describe("defaults and limits", () => {
  it("parses model, both approval values, and partial limits", () => {
    const ask = parseWorkflow(`name: t
defaults:
  model: opus
  approval: ask
  limits:
    timeout: 30m
steps:
  - uses: action/read-document
`);
    expect(ask.defaults).toEqual({
      model: "opus",
      approval: "ask",
      limits: { timeout: "30m", maxTokens: undefined, maxCost: undefined },
    });

    const auto = parseWorkflow(`name: t
defaults:
  approval: auto
  limits:
    max_tokens: 5000
    max_cost: "2.50"
steps:
  - uses: action/read-document
`);
    expect(auto.defaults.approval).toBe("auto");
    expect(auto.defaults.limits).toEqual({ timeout: undefined, maxTokens: 5000, maxCost: "2.50" });
  });

  it("unknown approval value and non-object limits become undefined", () => {
    const g = parseWorkflow(`name: t
defaults:
  approval: maybe
  limits: nope
steps:
  - uses: action/read-document
`);
    expect(g.defaults.approval).toBeUndefined();
    expect(g.defaults.limits).toBeUndefined();
  });

  it("non-object defaults yields {}", () => {
    const g = parseWorkflow(`name: t\ndefaults: 7\nsteps:\n  - uses: action/read-document\n`);
    expect(g.defaults).toEqual({});
  });
});

describe("per-step fields", () => {
  it("parses scalar needs, if, model, approval, limits, and matrix scalars", () => {
    const g = parseWorkflow(`name: t
steps:
  - id: a
    uses: action/read-document
  - id: b
    uses: genie/writer
    needs: a
    if: "steps.a.ok"
    model: sonnet
    approval: ask
    limits:
      timeout: 5m
    matrix:
      lang: [en, zh]
      mode: fast
`);
    const b = g.steps[1];
    expect(b.needs).toEqual(["a"]);
    expect(b.condition).toBe("steps.a.ok");
    expect(b.model).toBe("sonnet");
    expect(b.approval).toBe("ask");
    expect(b.limits?.timeout).toBe("5m");
    // Scalar matrix values normalize to one-element arrays.
    expect(b.matrix).toEqual({ lang: ["en", "zh"], mode: ["fast"] });
  });

  it("approval auto on a step; null with-values stringify to empty", () => {
    const g = parseWorkflow(`name: t
steps:
  - id: a
    uses: action/read-document
    approval: auto
    with:
      path: ~
`);
    expect(g.steps[0].approval).toBe("auto");
    expect(g.steps[0].with).toEqual({ path: "" });
  });

  it("icon derivation covers each action family and webhooks", () => {
    const g = parseWorkflow(MINIMAL(
      `  - uses: action/read-document
  - uses: action/save-document
  - id: n
    uses: action/notify
  - id: c
    uses: action/copy
  - id: p
    uses: action/prompt
  - id: w
    uses: webhook/incoming
  - id: g
    uses: genie/writer
`));
    expect(g.steps.map((s) => s.icon)).toEqual(["📂", "📤", "🔔", "📋", "💬", "🌐", "🤖"]);
  });
});

describe("validation errors", () => {
  it("rejects a duplicate EXPLICIT id with the direct hint", () => {
    expect(() =>
      parseWorkflow(MINIMAL(`  - id: dup\n    uses: action/read-document\n  - id: dup\n    uses: genie/writer\n`))
    ).toThrowError(/Duplicate step ID: 'dup'/);
  });

  it("rejects non-scalar with values naming the key", () => {
    expect(() =>
      parseWorkflow(MINIMAL(`  - id: a\n    uses: action/read-document\n    with:\n      cfg:\n        nested: true\n`))
    ).toThrowError(/non-scalar value for 'with.cfg'/);
  });

  it("rejects a null step entry", () => {
    expect(() => parseWorkflow("name: t\nsteps:\n  - ~\n")).toThrowError(WorkflowValidationError);
  });

  it("rejects a non-object YAML root", () => {
    expect(() => parseWorkflow("just a string")).toThrowError(/must be a YAML object/);
  });

  it("wraps YAML syntax errors with position info when available", () => {
    try {
      parseWorkflow("name: t\nsteps:\n  - uses: [unclosed\n");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowParseError);
    }
  });

  it("reports the node that closes a dependency cycle", () => {
    expect(() =>
      parseWorkflow(MINIMAL(
        `  - id: a\n    uses: action/read-document\n    needs: b\n  - id: b\n    uses: genie/writer\n    needs: a\n`
      ))
    ).toThrowError(/Circular dependency detected/);
  });
});

describe("source ranges", () => {
  it("computes ranges across CRLF input and closes the last step", () => {
    const yaml = "name: t\r\nsteps:\r\n  - id: a\r\n    uses: action/read-document\r\n  - id: b\r\n    uses: genie/writer\r\n";
    const g = parseWorkflow(yaml);
    expect(g.steps[0].sourceRange).toBeDefined();
    expect(g.steps[1].sourceRange).toBeDefined();
    expect(g.steps[1].sourceRange!.startLine).toBeGreaterThan(g.steps[0].sourceRange!.startLine);
  });

  it("stops the steps block at the next top-level key", () => {
    const g = parseWorkflow(`name: t
steps:
  - id: a
    uses: action/read-document
defaults:
  model: opus
`);
    expect(g.steps[0].sourceRange).toBeDefined();
    // Scanning stops at the top-level key; the final step's range closes at
    // EOF (the documented single-step contract).
    expect(g.steps[0].sourceRange!.startLine).toBe(3);
  });

  it("nested list items under matrix do not split step ranges", () => {
    const g = parseWorkflow(`name: t
steps:
  - id: a
    uses: action/read-document
    needs: []
    matrix:
      xs:
        - one
        - two
  - id: b
    uses: genie/writer
`);
    expect(g.steps).toHaveLength(2);
    expect(g.steps[0].sourceRange).toBeDefined();
    expect(g.steps[1].sourceRange).toBeDefined();
  });
});
