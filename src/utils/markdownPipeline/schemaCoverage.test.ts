/**
 * Schema coverage gate — WI-0.4.
 *
 * The corpus characterization harness is only a safety net if its schema can
 * represent everything the pipeline can emit. When a node type is absent from
 * the schema, the mdast→PM converters return `null`
 * (mdastBlockConverters.ts:210, mdastMediaConverters.ts:107,175) and the
 * orchestrator silently skips it (mdastToProseMirror.ts:252) — so the construct
 * is DELETED and the golden file records the deletion as correct.
 *
 * This test makes that failure loud instead of silent: it asserts the schema
 * used by the harness carries every node type the converters can produce.
 *
 * @module utils/markdownPipeline/schemaCoverage.test
 */
import { describe, it, expect } from "vitest";
import type { Schema } from "@tiptap/pm/model";
import { testSchema } from "./testSchema";
import { getProductionSchema } from "@/test/productionSchema";

/**
 * Node types the pipeline's mdast→PM converters can emit.
 *
 * Derived by reading the `schema.nodes.X` lookups in the converter modules; any
 * type here that a schema lacks becomes silent data loss rather than an error.
 */
const EMITTABLE_NODES = [
  "paragraph",
  "heading",
  "codeBlock",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "horizontalRule",
  "hardBreak",
  "text",
  "image",
  "block_image",
  "block_video",
  "block_audio",
  "video_embed",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "math_inline",
  "footnote_reference",
  "footnote_definition",
  "alertBlock",
  "detailsBlock",
  "detailsSummary",
  "wikiLink",
  "link_definition",
  "frontmatter",
  "html_inline",
  "html_block",
  "toc",
] as const;

const EMITTABLE_MARKS = [
  "bold",
  "italic",
  "strike",
  "code",
  "link",
  "subscript",
  "superscript",
  "highlight",
  "underline",
] as const;

function missingNodes(schema: Schema): string[] {
  return EMITTABLE_NODES.filter((n) => !schema.nodes[n]);
}

function missingMarks(schema: Schema): string[] {
  return EMITTABLE_MARKS.filter((m) => !schema.marks[m]);
}

describe("schema coverage", () => {
  describe("production schema (what the harness must use)", () => {
    it("carries every node type the converters can emit", () => {
      expect(missingNodes(getProductionSchema())).toEqual([]);
    });

    it("carries every mark type the converters can emit", () => {
      expect(missingMarks(getProductionSchema())).toEqual([]);
    });
  });

  describe("testSchema (the hand-mirrored schema — documents why it is unsafe)", () => {
    // Pinned deliberately. testSchema is a hand-maintained mirror, and this
    // assertion records the exact drift that made the old harness unsafe.
    // It is NOT a target to fix by editing testSchema — hand-extending a mirror
    // recreates the drift. The harness moves to the production projection.
    it("is missing node types, which is why it must not back the corpus harness", () => {
      expect(missingNodes(testSchema)).toEqual([
        "block_video",
        "block_audio",
        "video_embed",
        "toc",
      ]);
    });
  });
});
