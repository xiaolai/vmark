// WI-1.3 — token helpers for the @actions/workflow-parser AST.
// Tests use real parser output to verify the helpers walk the tree correctly.

import { describe, expect, it } from "vitest";
import { parseWorkflow } from "@actions/workflow-parser";
import {
  getMapping,
  getSequence,
  getString,
  getStringArray,
  getRecord,
  rangeOf,
  asMapping,
} from "../tokens";

const trace = { error: () => {}, info: () => {}, verbose: () => {} };

function parse(yaml: string) {
  return parseWorkflow({ name: "test.yml", content: yaml }, trace);
}

const SAMPLE = `
name: My Workflow
on: push
env:
  FOO: bar
  BAZ: qux
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

describe("rangeOf", () => {
  it("returns SourceRange when token has range", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value);
    expect(root).toBeDefined();
    const range = rangeOf(root!);
    expect(range).toBeDefined();
    expect(range!.startLine).toBeGreaterThan(0);
  });

  it("returns undefined for undefined token", () => {
    expect(rangeOf(undefined)).toBeUndefined();
  });
});

describe("asMapping", () => {
  it("returns MappingToken for an object value", () => {
    const r = parse(SAMPLE);
    expect(asMapping(r.value)).toBeDefined();
  });

  it("returns undefined for non-mapping or undefined", () => {
    expect(asMapping(undefined)).toBeUndefined();
  });
});

describe("getString", () => {
  it("returns string value for a string key", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value)!;
    expect(getString(root, "name")).toBe("My Workflow");
  });

  it("returns undefined for missing key", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value)!;
    expect(getString(root, "missing")).toBeUndefined();
  });

  it("returns undefined for non-string value", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value)!;
    // env is a mapping, not a string
    expect(getString(root, "env")).toBeUndefined();
  });
});

describe("getMapping", () => {
  it("returns inner mapping for a mapping key", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value)!;
    const env = getMapping(root, "env");
    expect(env).toBeDefined();
    expect(env!.count).toBe(2);
  });

  it("returns undefined for scalar value", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value)!;
    expect(getMapping(root, "name")).toBeUndefined();
  });
});

describe("getSequence", () => {
  it("returns sequence for an array value", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value)!;
    const jobs = getMapping(root, "jobs")!;
    const build = getMapping(jobs, "build")!;
    const steps = getSequence(build, "steps");
    expect(steps).toBeDefined();
    expect(steps!.count).toBe(1);
  });
});

describe("getStringArray", () => {
  it("returns string[] for branches: [main, dev]", () => {
    const r = parse(`
on:
  push:
    branches: [main, dev]
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: ok}]
`);
    const root = asMapping(r.value)!;
    const on = getMapping(root, "on")!;
    const push = getMapping(on, "push")!;
    expect(getStringArray(push, "branches")).toEqual(["main", "dev"]);
  });

  it("wraps single string into [string]", () => {
    const r = parse(`
on:
  push:
    branches: main
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: ok}]
`);
    const root = asMapping(r.value)!;
    const on = getMapping(root, "on")!;
    const push = getMapping(on, "push")!;
    expect(getStringArray(push, "branches")).toEqual(["main"]);
  });
});

describe("getRecord", () => {
  it("returns Record<string,string> for env block", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value)!;
    expect(getRecord(root, "env")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("returns undefined for missing key", () => {
    const r = parse(SAMPLE);
    const root = asMapping(r.value)!;
    expect(getRecord(root, "missing")).toBeUndefined();
  });
});
