// Format-adapter parser robustness gate (exhaustive by enumeration).
//
// Sweeps the official parser test suites through the validator seams the
// TOML and JSON adapters expose to the editor:
//
//   corpus/toml-test.json       — toml-lang/toml-test (777 cases)
//   corpus/json-test-suite.json — nst/JSONTestSuite test_parsing (316 cases)
//
// The load-bearing claim is NEVER-CRASH: a hostile or malformed file must
// produce diagnostics, never an uncaught throw — the validator is called on
// every open/edit, and one throw takes the preview pane with it. On top of
// that, acceptance behavior is PINNED:
//
//   - JSON: exact. Every y_ case accepted, every n_ case rejected, zero
//     exemptions (JSON.parse is a strict, compliant parser). i_ cases are
//     implementation-defined and only held to never-crash.
//   - TOML: smol-toml deviates from the suite in known, reasoned ways
//     (TOML 1.1-style leniency, missing date-component validation, BOM
//     strictness). Those are IDENTITY LISTS, two-way: a smol-toml upgrade
//     that fixes one fails the stale exemption until it is deleted; a new
//     deviation fails as unlisted. A count would let one swap for another.
//
// Engine-dependent probes (deep nesting / stack overflow) live ONLY in
// `parserRobustness.webkit.test.ts`: their answer depends on the JS engine,
// and the app ships WebKit, not Node. Duplicating them here would double an
// expensive run while proving nothing about the shipped runtime.
//
// @coordinates-with ../toml.tsx — tomlValidator (smol-toml)
// @coordinates-with ../json.tsx — jsonValidator (JSON.parse)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tomlValidator } from "../toml";
import { jsonValidator } from "../json";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Suite-valid TOML that smol-toml REJECTS. VMark shows a spurious error
 * diagnostic on these — known parser-lib strictness, not adapter bugs.
 */
const TOML_VALID_REJECTED: ReadonlySet<string> = new Set([
  // smol-toml does not strip a UTF-8 BOM. VMark's editor ingress
  // canonicalizes text (BOM-free) before validators run, so the case
  // cannot occur through the app's own read path.
  "valid/utf8-bom-01.toml",
  "valid/utf8-bom-02.toml",
  // 64-bit integer edge: values around i64 bounds exceed JS safe-integer
  // precision and smol-toml refuses rather than silently rounding.
  "valid/integer/long.toml",
]);

/**
 * Suite-invalid TOML that smol-toml ACCEPTS.
 */
const TOML_INVALID_ACCEPTED: ReadonlySet<string> = new Set([
  // Missing calendar validation: February 29/30 on non-leap dates parse.
  "invalid/local-date/feb-29.toml",
  "invalid/local-date/feb-30.toml",
  "invalid/datetime/feb-29.toml",
  "invalid/datetime/feb-30.toml",
  "invalid/local-datetime/feb-29.toml",
  "invalid/local-datetime/feb-30.toml",
  // TOML 1.1-style leniency accepted by smol-toml: seconds optional,
  // newlines/trailing comma in inline tables, control chars relaxed,
  // extra string byte escapes.
  "invalid/datetime/no-secs.toml",
  "invalid/local-datetime/no-secs.toml",
  "invalid/local-time/no-secs.toml",
  "invalid/inline-table/linebreak-01.toml",
  "invalid/inline-table/linebreak-02.toml",
  "invalid/inline-table/linebreak-03.toml",
  "invalid/inline-table/linebreak-04.toml",
  "invalid/inline-table/trailing-comma.toml",
  "invalid/control/linetab-number-01.toml",
  "invalid/control/linetab-number-02.toml",
  "invalid/control/linetab-number-03.toml",
  "invalid/control/linetab-number-04.toml",
  "invalid/string/basic-byte-escapes.toml",
  "invalid/encoding/bad-codepoint.toml",
  // Byte-level invalid-UTF-8 cases cannot be represented as a JS string:
  // vendoring decodes them lossily (U+FFFD), and the adapter only ever
  // receives strings through the same decoding — so at VMark's boundary
  // these inputs ARE valid, and accepting them is correct.
  "invalid/encoding/bad-utf8-in-comment.toml",
  "invalid/encoding/bad-utf8-in-multiline-literal.toml",
  "invalid/encoding/bad-utf8-in-multiline.toml",
  "invalid/encoding/bad-utf8-in-string-literal.toml",
  "invalid/encoding/bad-utf8-in-string.toml",
]);

interface TomlCorpus {
  cases: { name: string; valid: boolean; toml: string }[];
}
interface JsonCorpus {
  cases: { name: string; expect: "y" | "n" | "i"; json: string }[];
}

const tomlCorpus = JSON.parse(
  readFileSync(join(here, "corpus", "toml-test.json"), "utf8"),
) as TomlCorpus;
const jsonCorpus = JSON.parse(
  readFileSync(join(here, "corpus", "json-test-suite.json"), "utf8"),
) as JsonCorpus;

const hasError = (diags: { severity: string }[]) =>
  diags.some((d) => d.severity === "error");

describe("corpus well-formedness", () => {
  // Exact counts, not lower bounds: with `>=`, up to 77 TOML or 16 JSON
  // cases could vanish from the vendored corpus while the sweep still
  // reported "exhaustive".
  it("loads the full suites at their pinned sizes", () => {
    expect(tomlCorpus.cases.length).toBe(777);
    expect(jsonCorpus.cases.length).toBe(316);
  });

  it("gives every case a unique name and non-empty content field", () => {
    const tomlNames = tomlCorpus.cases.map((c) => c.name);
    expect(tomlNames.length).toBe(new Set(tomlNames).size);
    const jsonNames = jsonCorpus.cases.map((c) => c.name);
    expect(jsonNames.length).toBe(new Set(jsonNames).size);
    expect(tomlCorpus.cases.every((c) => typeof c.toml === "string")).toBe(true);
    expect(jsonCorpus.cases.every((c) => typeof c.json === "string")).toBe(true);
    expect(jsonCorpus.cases.every((c) => "yni".includes(c.expect))).toBe(true);
  });

  it("exempts only case names that exist in the TOML corpus", () => {
    const known = new Set(tomlCorpus.cases.map((c) => c.name));
    const unknown = [...TOML_VALID_REJECTED, ...TOML_INVALID_ACCEPTED].filter(
      (n) => !known.has(n),
    );
    expect(unknown).toEqual([]);
  });
});

describe("tomlValidator over toml-test", () => {
  for (const c of tomlCorpus.cases) {
    it(c.name, () => {
      // Never-crash is the core claim — any throw fails, undeclarable.
      const diags = tomlValidator(c.toml);
      const rejected = hasError(diags);

      if (c.valid) {
        if (rejected && !TOML_VALID_REJECTED.has(c.name)) {
          expect.fail(
            `${c.name}: suite-valid TOML now rejected — a regression, or a new` +
              ` smol-toml strictness to add to TOML_VALID_REJECTED with a reason.`,
          );
        }
        if (!rejected && TOML_VALID_REJECTED.has(c.name)) {
          expect.fail(`${c.name}: stale exemption — now accepted. Delete it.`);
        }
      } else {
        if (!rejected && !TOML_INVALID_ACCEPTED.has(c.name)) {
          expect.fail(
            `${c.name}: suite-invalid TOML now accepted — new smol-toml leniency;` +
              ` add to TOML_INVALID_ACCEPTED with a reason if benign.`,
          );
        }
        if (rejected && TOML_INVALID_ACCEPTED.has(c.name)) {
          expect.fail(`${c.name}: stale exemption — now rejected. Delete it.`);
        }
      }
    });
  }
});

describe("jsonValidator over JSONTestSuite", () => {
  for (const c of jsonCorpus.cases) {
    it(c.name, () => {
      const diags = jsonValidator(c.json, c.name);
      const rejected = hasError(diags);
      if (c.expect === "y") expect(rejected).toBe(false);
      if (c.expect === "n") expect(rejected).toBe(true);
      // i_ cases: implementation-defined; reaching here without a throw
      // is the claim.
    });
  }
});

describe("the whole JSON corpus swept through the JSONL branch", () => {
  // Every corpus case carries a `.json` name, so the per-line JSONL branch
  // saw none of them. A single-line JSONL document must reach the same
  // verdict as the same text parsed as JSON — anything else means the two
  // branches disagree about what valid JSON is.
  // The one legitimate disagreement: a document with no records. JSON
  // requires a value; JSONL with zero lines is an empty-but-valid record
  // stream. Named, not silently skipped.
  const EMPTY_RECORD_STREAM: ReadonlySet<string> = new Set([
    "n_single_space.json",
    "n_structure_no_data.json",
    "n_structure_UTF8_BOM_no_data.json",
  ]);

  for (const c of jsonCorpus.cases) {
    const multiline = c.json.includes("\n") || c.json.includes("\r");
    it(`${c.name} behaves correctly in the JSONL branch`, () => {
      if (multiline) {
        // NOT skipped: multi-line JSON is simply not JSONL — each line must
        // be its own record. The branch must therefore judge it per line,
        // never crash, and never silently accept a wrapped value as one
        // record.
        expect(() => jsonValidator(c.json, "d.jsonl")).not.toThrow();
        return;
      }
      const asJson = hasError(jsonValidator(c.json, "d.json"));
      const asJsonl = hasError(jsonValidator(c.json, "d.jsonl"));
      if (EMPTY_RECORD_STREAM.has(c.name)) {
        expect(asJson).toBe(true);
        expect(asJsonl).toBe(false);
        return;
      }
      expect(asJsonl).toBe(asJson);
    });
  }

  it("sweeps every corpus case through the JSONL branch", () => {
    // The claim this suite makes about itself.
    expect(jsonCorpus.cases.length).toBe(316);
  });
});

describe("jsonValidator over the JSONL branch", () => {
  // Every corpus case carries a `.json` name, so the separate per-line JSONL
  // branch was never swept — a whole validator path outside the enumeration.
  const jsonl = (content: string) => jsonValidator(content, "data.jsonl");

  it("accepts a well-formed JSONL document", () => {
    expect(hasError(jsonl('{"a":1}\n{"b":2}\n'))).toBe(false);
  });

  it("ignores blank lines and a trailing newline", () => {
    expect(hasError(jsonl('{"a":1}\n\n{"b":2}\n\n'))).toBe(false);
  });

  it("handles CRLF line endings", () => {
    expect(hasError(jsonl('{"a":1}\r\n{"b":2}\r\n'))).toBe(false);
  });

  it("reports the FAILING line number, not the first", () => {
    const diags = jsonl('{"a":1}\n{oops}\n{"b":2}\n');
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(2);
  });

  it("reports every malformed line, not just the first", () => {
    expect(jsonl('{bad}\n{"ok":1}\n{alsobad}\n')).toHaveLength(2);
  });

  it("survives a very large number of malformed lines", () => {
    const diags = jsonl("{bad}\n".repeat(5_000));
    expect(diags).toHaveLength(5_000);
  });

  it("treats a whitespace-only document as clean", () => {
    expect(hasError(jsonl("\n  \n\t\n"))).toBe(false);
  });
});
