// @vitest-environment node
// WI-AL3.1a — the comment anchor goldens the Rust resolver loads are what the production Markdown parser generates: every heading's depth, offset and source text, every heading path, and every widened block range; and a golden whose text the parser would rewrite before reading is refused
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { parseMarkdownToMdast } from "@/utils/markdownPipeline/parser";
import {
  assertParsedAsWritten,
  deriveFromParser,
  GOLDEN_PATH,
  type CommentAnchorGoldens,
} from "@/test/commentAnchorGoldens";

describe("comment anchor goldens", () => {
  it("the heading goldens equal what the production parser generates", () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as CommentAnchorGoldens;
    expect(golden.fixtures.length).toBeGreaterThanOrEqual(45);
    expect(golden.headingCases.length).toBeGreaterThan(0);
    expect(deriveFromParser(golden, parseMarkdownToMdast)).toEqual(golden);
  });

  it("a golden the parser would rewrite before reading is refused", () => {
    expect(() => assertParsedAsWritten("a \\== b\n")).toThrow(/escaped custom marker/);
    expect(() => assertParsedAsWritten("$$\n# a\n\n# b\n$$\n")).toThrow(/rewritten before parsing/);
    expect(() => assertParsedAsWritten("# plain\n")).not.toThrow();
  });
});
