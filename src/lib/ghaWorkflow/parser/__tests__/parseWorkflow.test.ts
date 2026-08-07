// @vitest-environment node
// WI-21 — parseWorkflow: `positions` reports declared top-level keys only.
/**
 * `parse` builds `ir.positions` — the click-to-jump map from a top-level
 * workflow key to its source range. The map's contract is per-key OPTIONAL:
 * `TopLevelPositions` declares every field with `?`, an empty `{}` is a valid
 * value (every panel test constructs one), and consumers read
 * `positions.env?.startLine`.
 *
 * The builder used to assign all eight keys unconditionally from `rangeOf(...)`,
 * so a workflow with no `env:` still got an `env` key holding `undefined`. Any
 * reader asking "which top-level keys does this file declare?" — `in`,
 * `Object.keys`, a spread merge — got all eight and a wrong answer. These tests
 * pin presence, not just the value, so the two cannot drift apart again.
 *
 * `index.ts` is a bare re-export of this module (and is excluded from
 * coverage), so these tests import the module directly.
 */
import { describe, expect, it } from "vitest";

import { parse } from "../parseWorkflow";

const MINIMAL = `name: minimal
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

const FULL = `name: full
run-name: run ${"${{ github.actor }}"}
on: push
permissions:
  contents: read
env:
  FOO: bar
defaults:
  run:
    shell: bash
concurrency:
  group: g
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

describe("parse — top-level positions", () => {
  it("records a range for each key the workflow declares", () => {
    const { positions } = parse(FULL);
    for (const key of [
      "name",
      "runName",
      "on",
      "permissions",
      "env",
      "defaults",
      "concurrency",
      "jobs",
    ] as const) {
      expect(positions[key], `expected a range for ${key}`).toBeDefined();
    }
  });

  it("omits keys the workflow does not declare, rather than storing undefined", () => {
    const { positions } = parse(MINIMAL);
    for (const key of ["runName", "permissions", "env", "defaults", "concurrency"]) {
      expect(key in positions, `${key} should be absent`).toBe(false);
    }
  });

  it("enumerates exactly the declared keys", () => {
    const { positions } = parse(MINIMAL);
    expect(Object.keys(positions).sort()).toEqual(["jobs", "name", "on"]);
  });

  it("points each range at that key's VALUE", () => {
    const { positions } = parse(MINIMAL);
    // Ranges cover the value, not the key: `name: minimal` and `on: push` are
    // inline so both land on their own line (1 and 2), while `jobs:`'s value is
    // the mapping that opens on the next line (4).
    expect(positions.name?.startLine).toBe(1);
    expect(positions.on?.startLine).toBe(2);
    expect(positions.jobs?.startLine).toBe(4);
  });

  it("returns an empty position map when the document is unusable", () => {
    const { positions } = parse("just a scalar");
    expect(Object.keys(positions)).toEqual([]);
  });
});
