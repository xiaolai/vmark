// Sanitizer adversarial gate — every XSS vector × every entry point.
//
// `sanitize.test.ts` tests hand-picked vectors against the ONE entry point
// each is about, and asserts what that function does with it. This gate
// asserts the property instead, over the full cross-product: no sanitizer
// output, from any entry point, may contain executable content.
//
// The cross-product is the point. The five entry points carry DIFFERENT
// allow-lists (media html permits video/audio/iframe; svg permits
// foreignObject + HTML profiles for Mermaid; katex is its own profile), so
// a vector proven dead in one says nothing about the others — and the gap
// between allow-lists is exactly where a hole hides. 62 vectors × 5 entry
// points = 310 assertions that no hand-written suite would enumerate.
//
// A NEGATIVE CONTROL runs the same detector over unsanitized input and
// requires it to fire. Without it, a detector that silently stopped
// matching (a bad regex edit, a renamed export) would report 310 greens
// while checking nothing — the vacuous-gate failure mode.
//
// @coordinates-with sanitizerVectors.ts — the corpus
// @coordinates-with ../sanitize.ts — the five entry points
import { describe, expect, it } from "vitest";
import {
  sanitizeHtmlPreview,
  sanitizeMediaHtml,
  sanitizeSvg,
  sanitizeKatex,
} from "../sanitize";
import { XSS_VECTORS } from "./sanitizerVectors";

/**
 * Every sanitizer surface a hostile string can reach, including the
 * widest configuration of the configurable one (extended allow-list,
 * block context, styles on) — the weakest posture VMark ever runs.
 */
const ENTRY_POINTS: readonly [string, (s: string) => string][] = [
  ["htmlPreview(inline,strict)", (s) => sanitizeHtmlPreview(s)],
  [
    "htmlPreview(block,extended,styles)",
    (s) =>
      sanitizeHtmlPreview(s, {
        context: "block",
        allowlistLevel: "extended",
        allowStyles: true,
      }),
  ],
  ["sanitizeMediaHtml", (s) => sanitizeMediaHtml(s)],
  ["sanitizeSvg", (s) => sanitizeSvg(s)],
  ["sanitizeKatex", (s) => sanitizeKatex(s)],
];

/**
 * Executable-content signatures. Substring matching on OUTPUT, so an
 * escaped payload (`&lt;script&gt;`) correctly does not match — it is
 * inert text by then.
 */
const EXEC_PATTERNS: readonly [string, RegExp][] = [
  ["script element", /<script/i],
  ["inline event handler", /\son[a-z]+\s*=/i],
  ["javascript: URL", /javascript\s*:/i],
  ["data:text/html URL", /data:text\/html/i],
  ["CSS expression()", /expression\s*\(/i],
  ["-moz-binding", /-moz-binding/i],
  ["object/embed", /<(object|embed)\b/i],
  ["iframe element", /<iframe/i],
  ["CSS behavior:", /behavior\s*:/i],
  ["SVG scripting element", /<(handler|listener|set)\b/i],
  ["iframe srcdoc", /\ssrcdoc\s*=/i],
  ["external resource ref", /<(use|image)\b[^>]*(xlink:)?href\s*=\s*["']?https?:/i],
  ["DOM-clobbering name/id", /\s(name|id)\s*=\s*["']?(body|attributes)["']?[\s>]/i],
  ["meta http-equiv", /<meta[^>]+http-equiv/i],
  ["base element", /<base\b/i],
  ["link element", /<link\b/i],
  ["style element", /<style\b/i],
];

/**
 * Two normalized views of the output, because HTML and URL parsing differ
 * and applying either globally produces a WRONG oracle.
 *
 * `decoded` — numeric character references resolved, NUL mapped to U+FFFD
 * (what the HTML tokenizer does; deleting it instead fabricated `<script>`
 * out of the inert `<scri\0pt>`).
 *
 * `urlView` — additionally strips tab/LF/CR, which the URL parser removes
 * from a URL. This is used ONLY for the URL-scheme patterns: applying it to
 * everything reported `<scri\npt>` as a script element, though a newline
 * terminates an HTML tag name and that markup is inert.
 */
function normalizeViews(text: string): { decoded: string; urlView: string } {
  const decoded = text
    .replace(/&#[xX]([0-9a-fA-F]+);?/g, (whole, hex: string) =>
      codePointOrRaw(parseInt(hex, 16), whole),
    )
    .replace(/&#(\d+);?/g, (whole, dec: string) =>
      codePointOrRaw(parseInt(dec, 10), whole),
    )
    .replace(/&Tab;/gi, "\t")
    .replace(/&NewLine;/gi, "\n")
    .replace(/\0/g, "\uFFFD");
  return { decoded, urlView: decoded.replace(/[\t\n\r]/g, "") };
}

/** A character reference outside Unicode range is U+FFFD, not a crash. */
function codePointOrRaw(code: number, whole: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "\uFFFD";
  try {
    return String.fromCodePoint(code);
  } catch {
    return whole;
  }
}

/** Patterns whose meaning is URL-scoped, so they read the stripped view. */
const URL_SCOPED = new Set(["javascript: URL", "data:text/html URL"]);

function executableHits(output: string): string[] {
  const { decoded, urlView } = normalizeViews(output);
  return EXEC_PATTERNS.filter(([name, re]) =>
    URL_SCOPED.has(name)
      ? re.test(output) || re.test(decoded) || re.test(urlView)
      : re.test(output) || re.test(decoded),
  ).map(([name]) => name);
}

describe("the gate is not vacuous", () => {
  it("has a non-trivial corpus over every entry point", () => {
    expect(XSS_VECTORS.length).toBeGreaterThanOrEqual(60);
    expect(ENTRY_POINTS.length).toBe(5);
  });

  it("gives every vector a unique id", () => {
    const ids = XSS_VECTORS.map((v) => v.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  // NEGATIVE CONTROL: the detector must fire on unsanitized input — EVERY
  // vector, with no exemptions. A detector that stopped matching would
  // otherwise report all-green while checking nothing, and an exemption here
  // is indistinguishable from that failure for the vectors it covers.
  it("detects executable content in every vector when NO sanitizer has run", () => {
    const undetected = XSS_VECTORS.filter(
      (v) => executableHits(v.input).length === 0,
    ).map((v) => v.id);
    expect(undetected).toEqual([]);
  });

  it("sees through browser-decoded obfuscation", () => {
    // The four shapes that motivated `decodeAsBrowser`.
    expect(executableHits('<a href="&#106;avascript:alert(1)">')).toContain(
      "javascript: URL",
    );
    expect(executableHits('<a href="&#x6A;avascript:alert(1)">')).toContain(
      "javascript: URL",
    );
    expect(executableHits('<a href="java\tscript:alert(1)">')).toContain(
      "javascript: URL",
    );
    expect(executableHits('<a href="java\nscript:alert(1)">')).toContain(
      "javascript: URL",
    );
    expect(executableHits('<a href="java&Tab;script:alert(1)">')).toContain(
      "javascript: URL",
    );
  });

  it("treats browser-inert markup as inert — the oracle must not over-fire", () => {
    // Each of these LOOKS like a script element to a naive normalizer but is
    // not one to a browser. A previous version deleted every C0 character and
    // reported `<scri\0pt>` as executable; demanding sanitizers strip inert
    // content is how a security gate starts producing false work.
    expect(executableHits("<scri\0pt>alert(1)</scri\0pt>")).toEqual([]);
    expect(executableHits("<scri\npt>alert(1)</scri\npt>")).toEqual([]);
  });

  it("does not crash on an out-of-range character reference", () => {
    expect(() => executableHits('<a href="&#999999999999;x">')).not.toThrow();
  });

  it("fires on each pattern family it claims to detect", () => {
    expect(executableHits("<script>x</script>")).toContain("script element");
    expect(executableHits('<img onerror="x">')).toContain("inline event handler");
    expect(executableHits('<a href="javascript:x">')).toContain("javascript: URL");
    // …and stays silent on inert, escaped output.
    expect(executableHits("&lt;script&gt;alert(1)&lt;/script&gt;")).toEqual([]);
  });
});

describe("no XSS vector survives any sanitizer", () => {
  for (const [entryName, sanitize] of ENTRY_POINTS) {
    describe(entryName, () => {
      for (const vector of XSS_VECTORS) {
        it(`${vector.id} (${vector.mechanism})`, () => {
          // A throw is never acceptable: these run on every preview render.
          const output = sanitize(vector.input);
          const hits = executableHits(output);
          expect(
            hits.length === 0
              ? ""
              : `\n  ${vector.id} survived ${entryName} as [${hits.join(", ")}]\n` +
                `  input:  ${JSON.stringify(vector.input)}\n` +
                `  output: ${JSON.stringify(output)}\n`,
          ).toBe("");
        });
      }
    });
  }
});
