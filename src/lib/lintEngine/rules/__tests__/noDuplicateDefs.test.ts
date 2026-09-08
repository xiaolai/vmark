// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { noDuplicateDefs } from "../noDuplicateDefs";
import type { Root, Definition } from "mdast";

/** The orchestrator always supplies a line index; direct-call tests need one too. */
const INDEX = { lines: [""], lineOffsets: [0] };

describe("E07 noDuplicateDefs", () => {
  it.each([
    {
      name: "clean: single definition not flagged",
      input: "[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: two identical definitions",
      input: "[ref]: https://a.com\n[ref]: https://b.com",
      expected: 1,
    },
    {
      name: "flagged: case-insensitive duplicate (REF vs ref)",
      input: "[REF]: https://a.com\n[ref]: https://b.com",
      expected: 1,
    },
    {
      name: "flagged: whitespace-collapsed duplicate",
      input: "[my ref]: https://a.com\n[my  ref]: https://b.com",
      expected: 1,
    },
    {
      name: "flagged: three definitions — second and third flagged",
      input: "[ref]: https://a.com\n[ref]: https://b.com\n[ref]: https://c.com",
      expected: 2,
    },
    {
      name: "clean: different labels are not duplicates",
      input: "[ref-a]: https://a.com\n[ref-b]: https://b.com",
      expected: 0,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
    {
      name: "clean: CJK labels not duplicated",
      input: "[标签一]: https://a.com\n[标签二]: https://b.com",
      expected: 0,
    },
    {
      name: "flagged: CJK label duplicated",
      input: "[标签]: https://a.com\n[标签]: https://b.com",
      expected: 1,
    },
  ])("$name → $expected E07 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "E07");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity, uiHint, messageKey and messageParams", () => {
    const result = lintMarkdown("[ref]: https://a.com\n[ref]: https://b.com");
    const d = result.find((d) => d.ruleId === "E07");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.uiHint).toBe("exact");
    expect(d!.messageKey).toBe("lint.E07");
    expect(d!.messageParams.ref).toBe("ref");
    expect(d!.line).toBe(2);
  });

  it("skips definition nodes without position", () => {
    // Synthetic MDAST with a duplicate definition that lacks position
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://a.com",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 21, offset: 20 },
          },
        },
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://b.com",
          // No position — should be skipped
        } as Definition,
      ],
    };

    const diagnostics = noDuplicateDefs("", mdast, INDEX);
    // The duplicate without position is skipped
    expect(diagnostics).toHaveLength(0);
  });

  it("falls back to identifier when label is null", () => {
    // Synthetic MDAST where label is undefined, falls back to identifier
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "myid",
          url: "https://a.com",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 21, offset: 20 },
          },
        } as Definition,
        {
          type: "definition",
          identifier: "myid",
          url: "https://b.com",
          position: {
            start: { line: 2, column: 1, offset: 21 },
            end: { line: 2, column: 21, offset: 41 },
          },
        } as Definition,
      ],
    };

    const diagnostics = noDuplicateDefs("", mdast, INDEX);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].messageParams.ref).toBe("myid");
  });

  it("falls back to empty string when both label and identifier are empty string", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "",
          url: "https://a.com",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 21, offset: 20 },
          },
        } as Definition,
        {
          type: "definition",
          identifier: "",
          url: "https://b.com",
          position: {
            start: { line: 2, column: 1, offset: 21 },
            end: { line: 2, column: 21, offset: 41 },
          },
        } as Definition,
      ],
    };

    const diagnostics = noDuplicateDefs("", mdast, INDEX);
    expect(diagnostics).toHaveLength(1);
  });

  it("falls back to empty string via ?? when both label and identifier are undefined/null", () => {
    // Both label and identifier are undefined — exercises the ?? "" fallback at line 21
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          url: "https://a.com",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 21, offset: 20 },
          },
        } as unknown as Definition,
        {
          type: "definition",
          url: "https://b.com",
          position: {
            start: { line: 2, column: 1, offset: 21 },
            end: { line: 2, column: 21, offset: 41 },
          },
        } as unknown as Definition,
      ],
    };

    const diagnostics = noDuplicateDefs("", mdast, INDEX);
    // Both have same normalized label (""), so second is flagged
    expect(diagnostics).toHaveLength(1);
  });

  it("uses offset fallback when position.start.offset is undefined", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://a.com",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 21, offset: 20 },
          },
        },
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://b.com",
          position: {
            start: { line: 2, column: 1 },
            end: { line: 2, column: 21 },
          },
        } as unknown as Definition,
      ],
    };

    const diagnostics = noDuplicateDefs("", mdast, INDEX);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(0);
  });
  // Audit R3 #816/#817.

  it("flags a POSITIONED duplicate of a positionless first occurrence (#816)", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://a.com",
          // No position — cannot be reported, but it is still an occurrence.
        } as Definition,
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://b.com",
          position: {
            start: { line: 2, column: 1, offset: 21 },
            end: { line: 2, column: 21, offset: 41 },
          },
        } as Definition,
      ],
    };

    const diagnostics = noDuplicateDefs("", mdast, INDEX);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].line).toBe(2);
  });

  it("treats Greek final sigma and sigma as one label, as CommonMark does (#817)", () => {
    const result = lintMarkdown("[σ]: https://a.com\n[ς]: https://b.com");
    expect(result.filter((d) => d.ruleId === "E07")).toHaveLength(1);
  });

  it("derives the offset from the line index when the node has no offset (#856)", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://a.com",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 21, offset: 20 },
          },
        } as Definition,
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://b.com",
          position: { start: { line: 3, column: 3 }, end: { line: 3, column: 9 } },
        } as unknown as Definition,
      ],
    };

    const diagnostics = noDuplicateDefs("", mdast, {
      lines: ["a", "b", "  [ref]: x"],
      lineOffsets: [0, 2, 4],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(6);
  });
});
