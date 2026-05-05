// WI-1.4 — detection heuristic tests.
//
// ADR-5: multi-signal detection — path, content shape, info-string,
// explicit "yaml workflow" marker.

import { describe, expect, it } from "vitest";
import { isWorkflowYaml, looksLikeWorkflowPath } from "../detection";

describe("looksLikeWorkflowPath", () => {
  it("matches .github/workflows/*.yml", () => {
    expect(looksLikeWorkflowPath(".github/workflows/ci.yml")).toBe(true);
    expect(looksLikeWorkflowPath("/abs/.github/workflows/release.yaml")).toBe(true);
  });

  it("rejects YAML files outside .github/workflows", () => {
    expect(looksLikeWorkflowPath("config/foo.yml")).toBe(false);
    expect(looksLikeWorkflowPath("docker-compose.yml")).toBe(false);
  });

  it("rejects non-YAML extensions", () => {
    expect(looksLikeWorkflowPath(".github/workflows/foo.txt")).toBe(false);
  });

  it("returns false for empty/undefined paths", () => {
    expect(looksLikeWorkflowPath("")).toBe(false);
    expect(looksLikeWorkflowPath(undefined)).toBe(false);
  });
});

describe("isWorkflowYaml", () => {
  it("accepts content with both on: and jobs: as objects", () => {
    expect(
      isWorkflowYaml(`on: push
jobs:
  a:
    runs-on: x
    steps: []
`),
    ).toBe(true);
  });

  it("accepts content with on: array form", () => {
    expect(
      isWorkflowYaml(`on: [push, pull_request]
jobs:
  a:
    runs-on: x
    steps: []
`),
    ).toBe(true);
  });

  it("rejects YAML without on:", () => {
    expect(
      isWorkflowYaml(`jobs:
  a:
    runs-on: x
    steps: []`),
    ).toBe(false);
  });

  it("rejects YAML without jobs:", () => {
    expect(isWorkflowYaml("on: push\nname: foo\n")).toBe(false);
  });

  it("rejects random YAML that has unrelated keys named on/jobs", () => {
    expect(
      isWorkflowYaml(`server:
  on: localhost
  jobs: 5
`),
    ).toBe(false);
  });

  it("rejects empty content", () => {
    expect(isWorkflowYaml("")).toBe(false);
    expect(isWorkflowYaml("\n\n")).toBe(false);
  });

  it("rejects malformed YAML", () => {
    expect(isWorkflowYaml("on: ::: bad")).toBe(false);
  });

  it("accepts the explicit workflow marker even if shape is partial", () => {
    // For code fences with explicit `yaml workflow` info string, the
    // detection short-circuits — caller passes opts.explicit=true.
    expect(
      isWorkflowYaml(
        `on: push
jobs: {}`,
        { explicit: true },
      ),
    ).toBe(true);
  });
});
