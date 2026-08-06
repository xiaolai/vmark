/**
 * Production ProseMirror schema projection — WI-0.1.
 *
 * Purpose: give the markdown-pipeline characterization harness the SAME schema
 * the app actually runs, instead of the hand-mirrored `testSchema.ts`.
 *
 * Why this exists:
 *   The corpus harness used `testSchema`, a hand-maintained mirror that had
 *   drifted — it lacks `toc`, `block_video`, `block_audio`, and `video_embed`.
 *   The mdast→PM converters return `null` for node types the schema lacks
 *   (mdastBlockConverters.ts:210, mdastMediaConverters.ts:107,175) and the
 *   orchestrator silently skips them (mdastToProseMirror.ts:252), so those
 *   constructs round-trip to NOTHING. A golden captured that way records the
 *   deletion as correct.
 *
 * Why a projection and not the editor:
 *   `getSchema()` builds a Schema from extension definitions alone — no Editor,
 *   no DOM mount, no React. `createTiptapExtensions()` is a pure factory. So the
 *   harness gets production fidelity without pulling UI code into Node tests.
 *
 * Why not just extend `testSchema`:
 *   Hand-extending a mirror recreates the drift that caused this bug. The mirror
 *   is only safe if nothing has to remember to update it.
 *
 * Location: this lives in `src/test/` rather than beside the pipeline because
 * `src/utils/` may not import `src/services/` (ADR-013, enforced by the
 * `utils-no-platform` dep-cruiser rule).
 *
 * @coordinates-with src/services/assembly/tiptapExtensions.ts — the composition
 *   root this projects from
 * @coordinates-with src/utils/markdownPipeline/schemaCoverage.test.ts — asserts
 *   this projection covers every emittable node type
 * @module test/productionSchema
 */
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { createTiptapExtensions } from "@/services/assembly/tiptapExtensions";

let cached: Schema | null = null;

/**
 * The schema the production WYSIWYG editor uses, built from extensions only.
 *
 * Cached because schema construction walks every extension; the harness calls
 * this once per corpus document.
 */
export function getProductionSchema(): Schema {
  if (cached === null) {
    cached = getSchema(createTiptapExtensions());
  }
  return cached;
}

/** Test-only reset, for suites that need a fresh build. */
export function _resetProductionSchema(): void {
  cached = null;
}
