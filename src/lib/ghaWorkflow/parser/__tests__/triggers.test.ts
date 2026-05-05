// WI-1.3 — trigger normalization tests.
//
// Plan §4 TriggerIR.
// Forms accepted:
//   on: push                                    → [{ event: "push" }]
//   on: [push, pull_request]                    → [{ event: "push" }, { event: "pull_request" }]
//   on: { push: { branches: [...] } }           → [{ event: "push", branches: [...] }]
//   on: { schedule: [{ cron: "..." }] }         → one TriggerIR per cron
//   on: { workflow_dispatch: { inputs: {...} } } → with inputs

import { describe, expect, it } from "vitest";
import { parseWorkflow } from "@actions/workflow-parser";
import { parseTriggers } from "../triggers";
import { asMapping, getMapping } from "../tokens";

const trace = { error: () => {}, info: () => {}, verbose: () => {} };

function getOnToken(yaml: string) {
  const r = parseWorkflow({ name: "t.yml", content: yaml }, trace);
  const root = asMapping(r.value);
  if (!root) throw new Error("parse failed: " + yaml);
  return root.find("on");
}

describe("parseTriggers", () => {
  it("returns empty array for missing on", () => {
    const map = asMapping(
      parseWorkflow(
        { name: "t.yml", content: "jobs:\n  a:\n    runs-on: x\n    steps: []\n" },
        trace,
      ).value,
    )!;
    const result = parseTriggers(map.find("on"));
    expect(result.triggers).toEqual([]);
  });

  it("parses string form: on: push", () => {
    const result = parseTriggers(
      getOnToken(`on: push
jobs:
  a:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers).toHaveLength(1);
    expect(result.triggers[0].event).toBe("push");
  });

  it("parses sequence form: on: [push, pull_request]", () => {
    const result = parseTriggers(
      getOnToken(`on: [push, pull_request]
jobs:
  a:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers).toHaveLength(2);
    expect(result.triggers.map((t) => t.event)).toEqual([
      "push",
      "pull_request",
    ]);
  });

  it("parses mapping form with branches filter", () => {
    const result = parseTriggers(
      getOnToken(`on:
  push:
    branches: [main, dev]
    paths-ignore: [docs/**]
jobs:
  a:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers).toHaveLength(1);
    expect(result.triggers[0].event).toBe("push");
    expect(result.triggers[0].branches).toEqual(["main", "dev"]);
    expect(result.triggers[0].pathsIgnore).toEqual(["docs/**"]);
  });

  it("parses pull_request types", () => {
    const result = parseTriggers(
      getOnToken(`on:
  pull_request:
    types: [opened, synchronize]
    branches: [main]
jobs:
  a:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers[0].types).toEqual(["opened", "synchronize"]);
    expect(result.triggers[0].branches).toEqual(["main"]);
  });

  it("emits one TriggerIR per cron line", () => {
    const result = parseTriggers(
      getOnToken(`on:
  schedule:
    - cron: "0 0 * * *"
    - cron: "0 12 * * *"
jobs:
  a:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers).toHaveLength(2);
    expect(result.triggers.every((t) => t.event === "schedule")).toBe(true);
    expect(result.triggers.map((t) => t.cron)).toEqual([
      "0 0 * * *",
      "0 12 * * *",
    ]);
  });

  it("parses workflow_dispatch with inputs", () => {
    const result = parseTriggers(
      getOnToken(`on:
  workflow_dispatch:
    inputs:
      version:
        description: "Version to release"
        required: true
        type: string
        default: "1.0.0"
      mode:
        type: choice
        options: [debug, release]
jobs:
  a:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers).toHaveLength(1);
    const t = result.triggers[0];
    expect(t.event).toBe("workflow_dispatch");
    expect(t.inputs).toBeDefined();
    expect(t.inputs!.version).toMatchObject({
      type: "string",
      required: true,
      default: "1.0.0",
    });
    expect(t.inputs!.mode).toMatchObject({
      type: "choice",
      options: ["debug", "release"],
    });
  });

  it("parses workflow_call with inputs/secrets/outputs", () => {
    const result = parseTriggers(
      getOnToken(`on:
  workflow_call:
    inputs:
      target:
        type: string
        required: true
    secrets:
      TOKEN:
        required: true
    outputs:
      version:
        value: \${{ jobs.build.outputs.version }}
        description: built version
jobs:
  build:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers[0].event).toBe("workflow_call");
    expect(result.triggers[0].inputs?.target).toMatchObject({ required: true });
    expect(result.triggers[0].secrets?.TOKEN).toMatchObject({ required: true });
    expect(result.triggers[0].outputs?.version).toMatchObject({
      value: expect.any(String),
    });
  });

  it("parses pull_request_target and emits GHA-SEC-001 advisory", () => {
    const result = parseTriggers(
      getOnToken(`on: pull_request_target
jobs:
  a:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers[0].event).toBe("pull_request_target");
    expect(result.diagnostics.some((d) => d.code === "GHA-SEC-001")).toBe(true);
  });

  it("parses workflow_run with workflows + types", () => {
    const result = parseTriggers(
      getOnToken(`on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
jobs:
  a:
    runs-on: x
    steps: []`),
    );
    expect(result.triggers[0].event).toBe("workflow_run");
    expect(result.triggers[0].workflows).toEqual(["CI"]);
    expect(result.triggers[0].types).toEqual(["completed"]);
  });
});

// Re-export to satisfy unused-import lint if test grows.
void getMapping;
