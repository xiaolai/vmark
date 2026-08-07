// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";

describe("E01 noUndefinedRefs", () => {
  it.each([
    {
      name: "clean: reference with matching definition",
      input: "See [this][ref]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: linkReference with no definition",
      input: "See [this][broken]",
      expected: 1,
    },
    {
      name: "flagged: imageReference with no definition",
      input: "![alt][missing-img]",
      expected: 1,
    },
    {
      name: "clean: case-insensitive label match",
      input: "See [this][REF]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "clean: whitespace-collapsed label match",
      input: "See [this][my  ref]\n\n[my ref]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: multiple missing refs each produce one diagnostic",
      input: "[first][missing1] and [second][missing2]",
      expected: 2,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
    {
      name: "clean: CJK label matched case-insensitively",
      input: "See [文本][标签]\n\n[标签]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: definition exists for different ref",
      input: "[text][ref-a]\n\n[ref-b]: https://example.com",
      expected: 1,
    },
    {
      name: "clean: inline link (not linkReference) never flagged",
      input: "[text](https://example.com)",
      expected: 0,
    },
    // Issue 5: collapsed and shortcut reference forms
    {
      name: "clean: collapsed reference [label][] with matching definition",
      input: "[ref][]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: collapsed reference [label][] with no definition",
      input: "[broken][]",
      expected: 1,
    },
    {
      name: "clean: shortcut reference [label] with matching definition",
      input: "[ref]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "clean: shortcut reference with no definition is not flagged (inline text)",
      input: "[notaref]",
      expected: 0,
    },
  ])("$name → $expected E01 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "E01");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity and fields", () => {
    const result = lintMarkdown("[text][broken]");
    const d = result.find((d) => d.ruleId === "E01");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.uiHint).toBe("exact");
    expect(d!.messageKey).toBe("lint.E01");
    expect(d!.messageParams.ref).toBe("broken");
    expect(d!.line).toBe(1);
  });
});
