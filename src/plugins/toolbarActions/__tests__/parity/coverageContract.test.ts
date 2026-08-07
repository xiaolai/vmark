// @vitest-environment node
/**
 * Behavioral parity — COVERAGE CONTRACT.
 *
 * Purpose: make the harness's coverage a checked fact rather than a claim in a
 * README. It derives the real shared action vocabulary from the two adapter
 * sources and asserts that every shared action is either behaviorally compared
 * or explicitly excused, with nothing falling between.
 *
 * Without this, the parity gate could pass forever while covering less and less:
 * a newly added action would simply not be in `COVERED_ACTIONS` and no test
 * would notice. That is the same failure mode the harness itself was built to
 * fix one level down — a green gate measuring a shrinking surface.
 *
 * The vocabulary is extracted the same way `adapterActionParity.test.ts` does it,
 * by reading the `case "…"` labels out of the adapter sources, so the contract
 * tracks the switches rather than a hand-kept list that can drift from them.
 *
 * @coordinates-with parityFixtures.ts — the declared partition
 * @coordinates-with ../../wysiwygAdapter.ts / ../../sourceAdapter.ts — the switches
 * @coordinates-with ../adapterActionParity.test.ts — the vocabulary-level counterpart
 * @module plugins/toolbarActions/__tests__/parity/coverageContract.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COVERED_ACTIONS,
  UNCOVERED_ACTIONS,
  SURFACE_EXCLUSIVE,
  MAX_UNCOVERED_ACTIONS,
} from "./parityFixtures";
import { PARITY_DIVERGENCES } from "./parityLedger";

const ROOT = process.cwd();

function caseLabels(relPath: string): Set<string> {
  const source = readFileSync(join(ROOT, relPath), "utf8");
  const labels = new Set<string>();
  for (const match of source.matchAll(/case "([^"]+)":/g)) labels.add(match[1]);
  return labels;
}

const wysiwyg = caseLabels("src/plugins/toolbarActions/wysiwygAdapter.ts");
const source = caseLabels("src/plugins/toolbarActions/sourceAdapter.ts");

const shared = [...wysiwyg].filter((a) => source.has(a)).sort();
const wysiwygOnly = [...wysiwyg].filter((a) => !source.has(a)).sort();
const sourceOnly = [...source].filter((a) => !wysiwyg.has(a)).sort();

/**
 * `heading:N` reaches the adapters through the dispatch prefix parser and
 * `set{Wysiwyg,Source}HeadingLevel`, not through a switch arm, so it never
 * appears in the extracted labels. The harness covers three levels of it; the
 * contract accounts for that separately instead of pretending it is a case.
 */
const HEADING_COVERED = COVERED_ACTIONS.filter((a) => a.startsWith("heading:"));
const coveredCases = COVERED_ACTIONS.filter((a) => !a.startsWith("heading:"));

describe("behavioral parity coverage contract", () => {
  it("extracts a non-empty shared vocabulary from both adapters", () => {
    expect(shared.length).toBeGreaterThan(0);
  });

  it("covers or excuses every shared action, with nothing in between", () => {
    const accounted = new Set([...coveredCases, ...Object.keys(UNCOVERED_ACTIONS)]);
    const unaccounted = shared.filter((a) => !accounted.has(a));
    expect(
      unaccounted.length === 0
        ? ""
        : `\n  ${unaccounted.length} shared action(s) are neither compared nor excused:\n` +
          `    ${unaccounted.join(", ")}\n` +
          `  Add each to COVERED_ACTIONS, or to UNCOVERED_ACTIONS with a structural reason.\n`,
    ).toBe("");
  });

  it("claims coverage only for actions both adapters route", () => {
    const notShared = coveredCases.filter((a) => !shared.includes(a));
    expect(
      notShared.length === 0
        ? ""
        : `\n  COVERED_ACTIONS names ${notShared.join(", ")}, which both adapters do not route.\n` +
          `  Parity is undefined for a single-surface action — move it to SURFACE_EXCLUSIVE.\n`,
    ).toBe("");
  });

  it("excuses only actions that exist and are not already covered", () => {
    const excused = Object.keys(UNCOVERED_ACTIONS);
    const gone = excused.filter((a) => !shared.includes(a));
    const alsoCovered = excused.filter((a) => coveredCases.includes(a));
    expect(
      gone.length === 0 && alsoCovered.length === 0
        ? ""
        : `\n${gone.length ? `  UNCOVERED_ACTIONS names ${gone.join(", ")}, which no longer exist in both adapters — delete them.\n` : ""}` +
          `${alsoCovered.length ? `  ${alsoCovered.join(", ")} are listed as uncovered but ARE covered — delete the excuse.\n` : ""}`,
    ).toBe("");
  });

  it("gives every excuse a stated reason", () => {
    const empty = Object.entries(UNCOVERED_ACTIONS)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([action]) => action);
    expect(
      empty.length === 0
        ? ""
        : `\n  ${empty.join(", ")} lack a real reason. An excuse must name a structural obstacle.\n`,
    ).toBe("");
  });

  it("holds the uncovered count at or below its ratchet", () => {
    const count = Object.keys(UNCOVERED_ACTIONS).length;
    expect(
      count <= MAX_UNCOVERED_ACTIONS
        ? ""
        : `\n  ${count} shared actions uncovered but the ceiling is ${MAX_UNCOVERED_ACTIONS}.\n` +
          `  This gate ratchets DOWN only — never raise the ceiling.\n`,
    ).toBe("");
  });

  it("declares the per-surface exclusives that really are exclusive", () => {
    const declared = Object.keys(SURFACE_EXCLUSIVE).sort();
    const actual = [...wysiwygOnly, ...sourceOnly].sort();
    expect(declared).toEqual(actual);
  });

  it("covers heading levels through the dispatch prefix, not a switch arm", () => {
    expect(HEADING_COVERED.length).toBeGreaterThan(0);
    expect(shared).not.toContain("heading:1");
  });

  it("records divergences only for actions it compares", () => {
    const orphans = Object.keys(PARITY_DIVERGENCES).filter((a) => !COVERED_ACTIONS.includes(a));
    expect(
      orphans.length === 0
        ? ""
        : `\n  ${orphans.join(", ")} declared divergent but not compared — the claim is unverified.\n`,
    ).toBe("");
  });
});
