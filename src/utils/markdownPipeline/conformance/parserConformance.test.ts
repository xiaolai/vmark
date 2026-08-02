/**
 * WI-3.2 — the two-projection parser conformance gate.
 *
 * `document` and `source-position` must produce the same SEMANTICS. Where they
 * do not, the difference is declared with a reason. The comparison is a typed
 * projection that keeps node type, ordered children, semantic values and
 * extension attributes, and drops only position and renderer plumbing — spelled
 * out in `semanticProjection.ts` so the gate cannot be made to pass by
 * discarding more.
 *
 * This is the last line of defence for the plan's highest-rated risk (R3,
 * wrong-range destructive edits) now that the structure index has moved to the
 * design doc, so the gate is written to fail in both directions: an undeclared
 * divergence fails, and so does a declaration nothing matches.
 *
 * Offsets: verified only for nodes `positionTrust` considers trustworthy.
 * Synthesised nodes carry offsets that address a re-parsed substring, so
 * "checking" them would assert a coincidence.
 *
 * @coordinates-with fixtures.ts — the one manifest every matrix derives from
 * @coordinates-with semanticProjection.ts — what is compared
 * @coordinates-with expectedDeltas.ts — the declared differences
 * @module utils/markdownPipeline/conformance/parserConformance.test
 */
import { describe, it, expect } from "vitest";
import { visit } from "unist-util-visit";
import "../dialect";
import { createProcessor, createMarkdownProcessor } from "../parser/processorFactory";
import {
  collectUntrusted,
  canonicalRangeOf,
  PREFIX_STRIPPING_CONTAINERS,
  type PositionedNode,
} from "../positionTrust";
import {
  CONTENT_CLASSES,
  FIXTURES,
  fixturesOfClass,
  type ConformanceFixture,
} from "./fixtures";
import { project, diff, type RawNode } from "./semanticProjection";
import { EXPECTED_DELTAS, matches } from "./expectedDeltas";

function parseAs(mode: "document" | "source-position", markdown: string): RawNode {
  const processor =
    mode === "document" ? createProcessor(markdown) : createMarkdownProcessor();
  return processor.runSync(processor.parse(markdown)) as unknown as RawNode;
}

const divergencesFor = (fixture: ConformanceFixture) =>
  diff(
    project(parseAs("document", fixture.markdown)),
    project(parseAs("source-position", fixture.markdown))
  );

describe("the manifest is the single source of the matrix", () => {
  it("gives every fixture a unique, stable id", () => {
    const ids = FIXTURES.map((f) => f.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("covers every content class — an empty class is a named coverage hole", () => {
    const empty = CONTENT_CLASSES.filter((c) => fixturesOfClass(c).length === 0);
    expect(empty).toEqual([]);
  });

  it("gives every fixture a stated reason for existing", () => {
    expect(FIXTURES.filter((f) => f.note.trim().length < 20).map((f) => f.id)).toEqual([]);
  });

  it("uses canonical editor text throughout — no CRLF, no BOM", () => {
    // The position domain is `canonicalEditorText` (decision D3). CRLF is
    // WI-1.9's job, through the real ingress; here it would measure only
    // harness skew.
    const impure = FIXTURES.filter(
      (f) => f.markdown.includes("\r") || f.markdown.startsWith("\u{FEFF}")
    );
    expect(impure.map((f) => f.id)).toEqual([]);
  });
});

describe("the two projections agree except where declared", () => {
  it.each([...FIXTURES])("$id ($contentClass)", (fixture) => {
    const undeclared = divergencesFor(fixture).filter(
      (d) => !EXPECTED_DELTAS.some((delta) => matches(delta, d, fixture.id))
    );

    expect(
      undeclared.map((d) => `${d.path} ${d.kind} ${d.detail}`)
    ).toEqual([]);
  });
});

describe("the delta list cannot rot into a suppression file", () => {
  it("every declared delta matches a real divergence", () => {
    // A stale entry silently absorbs the next genuine divergence at its path.
    const unmatched = EXPECTED_DELTAS.filter((delta) => {
      const fixture = FIXTURES.find((f) => f.id === delta.fixtureId);
      if (!fixture) return true;
      return !divergencesFor(fixture).some((d) => matches(delta, d, fixture.id));
    });

    expect(unmatched.map((d) => `${d.fixtureId} ${d.path} ${d.kind}`)).toEqual([]);
  });

  it("every declared delta names a fixture that exists", () => {
    const orphans = EXPECTED_DELTAS.filter(
      (d) => !FIXTURES.some((f) => f.id === d.fixtureId)
    );
    expect(orphans.map((d) => d.fixtureId)).toEqual([]);
  });

  it("every declared delta carries a reason", () => {
    expect(
      EXPECTED_DELTAS.filter((d) => d.reason.trim().length < 20).map((d) => d.fixtureId)
    ).toEqual([]);
  });
});

describe("the repaired input proves the gate is not vacuous", () => {
  it("cm-bare-list-marker DOES diverge, and passes only because it is declared", () => {
    const fixture = FIXTURES.find((f) => f.id === "cm-bare-list-marker")!;
    const divergences = divergencesFor(fixture);

    // If this ever becomes empty the declaration is stale, and the check above
    // will say so — but assert it here too, because a gate whose one
    // interesting case silently stopped diverging proves nothing.
    expect(divergences.length).toBeGreaterThan(0);
    expect(
      divergences.every((d) =>
        EXPECTED_DELTAS.some((delta) => matches(delta, d, fixture.id))
      )
    ).toBe(true);
  });
});

describe("offsets, where they can be trusted", () => {
  it.each([...FIXTURES])("$id — every trusted range is well-formed and in bounds", (fixture) => {
    const tree = parseAs("source-position", fixture.markdown) as unknown as PositionedNode;
    const untrusted = collectUntrusted(tree);
    const length = fixture.markdown.length;

    visit(tree as never, (node: PositionedNode) => {
      if (untrusted.has(node)) return;
      const range = canonicalRangeOf(node);
      if (!range) return;
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(length);
      expect(range.end).toBeGreaterThanOrEqual(range.start);
    });
  });

  it.each([...FIXTURES])("$id — a trusted range never splits a surrogate pair", (fixture) => {
    // An offset landing between the high and low halves of an astral character
    // slices it into two lone surrogates. This is the check that catches
    // code-point/code-unit confusion, which CJK alone would not surface.
    const text = fixture.markdown;
    const tree = parseAs("source-position", text) as unknown as PositionedNode;
    const untrusted = collectUntrusted(tree);

    const splitsPair = (offset: number) =>
      offset > 0 &&
      offset < text.length &&
      text.charCodeAt(offset - 1) >= 0xd800 &&
      text.charCodeAt(offset - 1) <= 0xdbff &&
      text.charCodeAt(offset) >= 0xdc00 &&
      text.charCodeAt(offset) <= 0xdfff;

    visit(tree as never, (node: PositionedNode) => {
      if (untrusted.has(node)) return;
      const range = canonicalRangeOf(node);
      if (!range) return;
      expect(splitsPair(range.start)).toBe(false);
      expect(splitsPair(range.end)).toBe(false);
    });
  });

  it.each(FIXTURES.filter((f) => f.positions === "all-canonical"))(
    "$id — a trusted leaf's slice round-trips, outside prefix-stripping containers",
    (fixture) => {
      // A text node inside a blockquote or list item has a CANONICAL range —
      // it addresses the right span — but its `value` has the `> ` / indent
      // continuation markers removed, so the slice is not the value. The gate
      // found this on `> quoted\n> more`; it is recorded in
      // PREFIX_STRIPPING_CONTAINERS rather than papered over, because code
      // that rebuilds content from a range needs to know.
      const tree = parseAs("source-position", fixture.markdown) as unknown as PositionedNode;
      const untrusted = collectUntrusted(tree);

      const walk = (node: PositionedNode, stripped: boolean): void => {
        if (node.type === "text" && !stripped && !untrusted.has(node)) {
          const range = canonicalRangeOf(node);
          const value = (node as { value?: unknown }).value;
          if (range && typeof value === "string") {
            expect(fixture.markdown.slice(range.start, range.end)).toBe(value);
          }
        }
        for (const child of node.children ?? []) {
          walk(child, stripped || PREFIX_STRIPPING_CONTAINERS.has(node.type));
        }
      };
      walk(tree, false);
    }
  );

  it.each(FIXTURES.filter((f) => f.positions === "all-canonical"))(
    "$id — all-canonical means ZERO untrusted nodes, not merely 'checked ones pass'",
    (fixture) => {
      // The classification promised every node has a canonical range, but the
      // offset checks only SKIPPED untrusted nodes — so a position regression
      // could turn a whole fixture untrusted and every check would still pass
      // by looking at nothing. `gfm-strikethrough` was misclassified exactly
      // this way: `~single~` is a positionless subscript node.
      const tree = parseAs("source-position", fixture.markdown) as unknown as PositionedNode;
      expect([...collectUntrusted(tree)].map((n) => n.type)).toEqual([]);
    }
  );

  it("fixtures declaring synthesised nodes really contain some", () => {
    // Otherwise `partial-synthesised` is a way to opt out of the offset checks.
    for (const fixture of FIXTURES.filter((f) => f.positions === "partial-synthesised")) {
      const tree = parseAs("source-position", fixture.markdown) as unknown as PositionedNode;
      expect(collectUntrusted(tree).size).toBeGreaterThan(0);
    }
  });
});
