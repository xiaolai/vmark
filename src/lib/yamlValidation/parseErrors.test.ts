// @vitest-environment node
// WI-FL5.7 — YAML parse-error offsets. `collectYamlParseErrors` is the one
// parse step behind the CodeMirror gutter (plugins/codemirror/sourceYamlLint)
// and the lint-store adapter (lib/lintEngine/yaml), which turns `from` into a
// 1-based line/column by counting "\n". Everything here pins the contract those
// consumers rely on: offsets index the ORIGINAL text as UTF-16 code units — a
// CR, a BOM or a CJK/astral character ahead of the fault shifts them exactly as
// it shifts the text — ranges the parser reports past the end are clamped, and
// nothing ever throws; a parser failure becomes one diagnostic at offset 0.
//
// Feature ledger, Area 3 "YAML parse-error diagnostics" (id yaml-validation).

import { describe, it, expect, afterEach, vi } from "vitest";

// A boundary mock over the `yaml` package that delegates to the real parser
// unless a test arms `parseControl.throwNext`. It exists for one branch — the
// try/catch around `parseDocument` — which no YAML TEXT can reach: the parser
// reports malformed input through `doc.errors`, so the only way to exercise
// the catch is a parser that throws.
const parseControl = vi.hoisted(() => ({ throwNext: null as Error | null }));
vi.mock("yaml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("yaml")>();
  const parseDocument = ((
    source: string,
    options?: Parameters<typeof actual.parseDocument>[1],
  ) => {
    if (parseControl.throwNext) {
      const error = parseControl.throwNext;
      parseControl.throwNext = null;
      throw error;
    }
    return actual.parseDocument(source, options);
  }) as unknown as typeof actual.parseDocument;
  return { ...actual, parseDocument };
});

import { collectYamlParseErrors, type YamlParseDiagnostic } from "./parseErrors";

/**
 * The 1-based line/column `lib/lintEngine/yaml.ts` derives from an offset:
 * "\n" ends a line, every other code unit — a CR included — is one column.
 * Re-stated here rather than imported so the expectation is independent of
 * the consumer under test.
 */
function lineColOf(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < Math.min(offset, text.length); i++) {
    if (text[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function expectInRange(diags: YamlParseDiagnostic[], text: string): void {
  expect(diags.length).toBeGreaterThan(0);
  for (const d of diags) {
    expect(d.from).toBeGreaterThanOrEqual(0);
    expect(d.from).toBeLessThanOrEqual(d.to);
    expect(d.to).toBeLessThanOrEqual(text.length);
  }
}

afterEach(() => {
  parseControl.throwNext = null;
});

describe("collectYamlParseErrors — clean input yields no diagnostic", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", "   \n\n"],
    ["a comment only", "# just a comment\n"],
    ["a valid mapping", "name: ci\non: push\n"],
    ["a valid mapping with CRLF line endings", "name: ci\r\non: push\r\n"],
    ["a valid mapping in CJK", "名前: 値\n"],
  ])("%s", (_label, text) => {
    expect(collectYamlParseErrors(text)).toEqual([]);
  });
});

describe("collectYamlParseErrors — offsets index the original text", () => {
  it("reports a duplicate key at the second key (LF)", () => {
    const text = "name: a\nname: b\n";
    const diags = collectYamlParseErrors(text);

    expect(diags).toHaveLength(1);
    const [d] = diags;
    expect(d.severity).toBe("error");
    expect(d.message).toMatch(/unique|duplicat/i);
    expect(d.from).toBe(text.indexOf("name", 1));
    expect(text.startsWith("name", d.from)).toBe(true);
    expect(d.to).toBeGreaterThan(d.from);
    expect(lineColOf(text, d.from)).toEqual({ line: 2, column: 1 });
  });

  it("counts a CR as one code unit, so CRLF shifts the offset by one per line", () => {
    const lf = "name: a\nname: b\n";
    const crlf = "name: a\r\nname: b\r\n";
    const [onLf] = collectYamlParseErrors(lf);
    const [onCrlf] = collectYamlParseErrors(crlf);

    expect(onCrlf.from).toBe(crlf.indexOf("name", 1));
    expect(onCrlf.from).toBe(onLf.from + 1);
    // The consumer's line/column derivation still lands on line 2, column 1:
    // the CR sits at the end of line 1, not at the start of line 2.
    expect(lineColOf(crlf, onCrlf.from)).toEqual({ line: 2, column: 1 });
  });

  it("counts a CJK character as one code unit", () => {
    const text = "名前: a\n名前: b\n";
    const [d] = collectYamlParseErrors(text);

    expect(d.from).toBe(text.indexOf("名前", 1));
    expect(text.startsWith("名前", d.from)).toBe(true);
    expect(lineColOf(text, d.from)).toEqual({ line: 2, column: 1 });
  });

  it("counts an astral character as two code units, like the editor's own offsets", () => {
    // "😀" is one code point but a surrogate PAIR in UTF-16 — the unit
    // CodeMirror and ProseMirror both index by. "😀: a\n" is 6 units, not 5.
    const text = "😀: a\n😀: b\n";
    const [d] = collectYamlParseErrors(text);

    expect("😀: a\n").toHaveLength(6);
    expect(d.from).toBe(text.indexOf("😀", 1));
    expect(d.from).toBe(6);
    expect(d.to).toBeGreaterThan(d.from);
    expect(d.to).toBeLessThanOrEqual(text.length);
  });

  it("counts a leading BOM as one code unit", () => {
    const plain = "name: a\nname: b\n";
    const withBom = `\uFEFF${plain}`;
    const [onPlain] = collectYamlParseErrors(plain);
    const [onBom] = collectYamlParseErrors(withBom);

    expect(onBom.from).toBe(withBom.indexOf("name", withBom.indexOf("name") + 1));
    expect(onBom.from).toBe(onPlain.from + 1);
  });

  it("combines CRLF and CJK ahead of the fault", () => {
    const text = "名前: a\r\n名前: b\r\n";
    const [d] = collectYamlParseErrors(text);

    expect(d.from).toBe(text.indexOf("名前", 1));
    expect(lineColOf(text, d.from)).toEqual({ line: 2, column: 1 });
  });

  it("reports a tab used as indentation at the tab itself", () => {
    const text = "a:\n\tb: 1\n";
    const diags = collectYamlParseErrors(text);
    expectInRange(diags, text);

    const atTab = diags.find((d) => text[d.from] === "\t");
    expect(atTab).toBeDefined();
    expect(atTab!.severity).toBe("error");
    expect(lineColOf(text, atTab!.from)).toEqual({ line: 2, column: 1 });
  });

  it("keeps a parser WARNING at its own severity and range", () => {
    // An unresolved tag is the one parse-level condition the `yaml` package
    // classes as a warning rather than an error.
    const text = "a: !foo bar\n";
    const diags = collectYamlParseErrors(text);

    expect(diags).toHaveLength(1);
    const [w] = diags;
    expect(w.severity).toBe("warning");
    expect(text.slice(w.from, w.to)).toBe("!foo");
    expect(lineColOf(text, w.from)).toEqual({ line: 1, column: 4 });
  });

  it("offsets a warning behind CRLF and CJK content exactly like an error", () => {
    const text = "名: 1\r\na: !foo bar\r\n";
    const diags = collectYamlParseErrors(text);

    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(text.slice(diags[0].from, diags[0].to)).toBe("!foo");
    expect(lineColOf(text, diags[0].from)).toEqual({ line: 2, column: 4 });
  });

  it("reports every error of a multi-line fault, in document order and in range", () => {
    const text = "list:\n  - item\n - item2\n";
    const diags = collectYamlParseErrors(text);
    expectInRange(diags, text);

    expect(diags.every((d) => d.severity === "error")).toBe(true);
    expect(lineColOf(text, diags[0].from)).toEqual({ line: 3, column: 1 });
    for (const d of diags) {
      expect(lineColOf(text, d.from).line).toBeGreaterThanOrEqual(3);
    }
    const froms = diags.map((d) => d.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
  });
});

describe("collectYamlParseErrors — ranges the parser reports past the end are clamped", () => {
  it("places a missing closing quote at the end of the text, not one past it", () => {
    // The parser reports the missing character at [len, len + 1]. A CodeMirror
    // diagnostic outside the document throws inside the linter, so `to` (and
    // `from`, which starts AT the end) are both clamped to the text length.
    const text = 'value: "unterminated\n';
    const diags = collectYamlParseErrors(text);

    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].from).toBe(text.length);
    expect(diags[0].to).toBe(text.length);
  });

  it("clamps an unterminated flow sequence the same way", () => {
    const text = "a: [1, 2";
    const diags = collectYamlParseErrors(text);
    expectInRange(diags, text);
    expect(diags[0].to).toBe(text.length);
  });
});

describe("collectYamlParseErrors — never throws", () => {
  it("turns garbled input into in-range error diagnostics", () => {
    const text = ":::\n@@@\n";
    let diags: YamlParseDiagnostic[] = [];
    expect(() => {
      diags = collectYamlParseErrors(text);
    }).not.toThrow();

    expectInRange(diags, text);
    expect(diags.every((d) => d.severity === "error")).toBe(true);
    expect(diags.every((d) => d.message.length > 0)).toBe(true);
  });

  it("reports a second document as an error at the separator", () => {
    const text = "a: 1\n---\nb: 2\n";
    const diags = collectYamlParseErrors(text);

    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].from).toBe(text.indexOf("---"));
    expect(lineColOf(text, diags[0].from)).toEqual({ line: 2, column: 1 });
  });

  it("turns a parser that THROWS into one error at the document start", () => {
    parseControl.throwNext = new Error("boom");
    const text = "name: a\nname: b\n";

    let diags: YamlParseDiagnostic[] = [];
    expect(() => {
      diags = collectYamlParseErrors(text);
    }).not.toThrow();

    expect(diags).toEqual([
      {
        from: 0,
        to: 1,
        severity: "error",
        message: "YAML parse failed catastrophically",
      },
    ]);
  });

  it("recovers on the next call once the parser stops throwing", () => {
    parseControl.throwNext = new Error("boom");
    collectYamlParseErrors("a: 1\n");
    expect(collectYamlParseErrors("a: 1\n")).toEqual([]);
  });
});
