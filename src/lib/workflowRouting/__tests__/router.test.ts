// WI-1.5 — workflow router tests.
//
// ADR-10: detect GHA / Genie / none for a given file path + content.
// Priority order:
//   1. Path under .github/workflows/ AND parses as GHA workflow → "gha"
//   2. Genie shape (per existing 20260331 plan)              → "genie"
//   3. Otherwise                                              → "none"

import { describe, expect, it } from "vitest";
import { routeWorkflow } from "../router";

describe("routeWorkflow", () => {
  it("returns 'gha' for path under .github/workflows AND GHA shape", () => {
    expect(
      routeWorkflow({
        path: ".github/workflows/ci.yml",
        content: `on: push
jobs:
  build:
    runs-on: x
    steps: []
`,
      }),
    ).toBe("gha");
  });

  it("returns 'gha' for any path with explicit GHA shape", () => {
    expect(
      routeWorkflow({
        path: "anywhere.yml",
        content: `on: push
jobs:
  a:
    runs-on: x
    steps: []
`,
      }),
    ).toBe("gha");
  });

  it("returns 'genie' for Genie shape outside .github/workflows", () => {
    expect(
      routeWorkflow({
        path: "tasks/summarize.yml",
        content: `name: Summarize
steps:
  - uses: genie/summarize
`,
      }),
    ).toBe("genie");
  });

  it("returns 'none' for plain YAML config files", () => {
    expect(
      routeWorkflow({
        path: "docker-compose.yml",
        content: `version: "3"
services:
  web:
    image: nginx
`,
      }),
    ).toBe("none");
  });

  it("returns 'none' for empty content", () => {
    expect(routeWorkflow({ path: "x.yml", content: "" })).toBe("none");
  });

  it("returns 'gha' if path is under .github/workflows even with sparse content", () => {
    // Path-as-strong-signal rule: if it lives in .github/workflows/, we
    // treat it as a workflow even if content is being actively edited
    // and momentarily doesn't pass the shape heuristic.
    expect(
      routeWorkflow({
        path: ".github/workflows/wip.yml",
        content: "on:\n",
      }),
    ).toBe("gha");
  });

  it("prefers 'gha' when both shapes match (GHA wins over Genie)", () => {
    // GHA workflows have steps with uses too; the disambiguator is the
    // presence of `jobs:`.
    expect(
      routeWorkflow({
        path: "anywhere.yml",
        content: `name: x
on: push
jobs:
  a:
    runs-on: x
    steps:
      - uses: genie/summarize
`,
      }),
    ).toBe("gha");
  });
});
