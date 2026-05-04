/**
 * Purpose: CST-preserving parser for the GHA workflow save path.
 *   Wraps the `yaml` package's `parseDocument` API. The CST preserves
 *   comments, anchors, aliases, and key order — properties the
 *   read-side `@actions/workflow-parser` does not retain.
 *
 *   The ADR-11 gate is enforced by `cstParser.test.ts` against the
 *   22-fixture corpus on every commit.
 *
 * Key decisions:
 *   - WORKFLOW_YAML_STRINGIFY_OPTIONS = { lineWidth: 0,
 *     flowCollectionPadding: false } per Spike D's empirical finding.
 *     With these options 4-5 of 7 vmark fixtures are byte-identical;
 *     all 22 preserve comments + anchors + semantics.
 *   - semanticEqual() is the load-bearing equality check used by both
 *     the round-trip gate and by mutators that need to verify their
 *     output equals the IR-level expectation.
 *
 * @coordinates-with src/lib/ghaWorkflow/save/mutators/* — uses these
 *   primitives to apply IRPatches to a Document
 * @module lib/ghaWorkflow/save/cstParser
 */

import { parseDocument, type Document, type ToStringOptions } from "yaml";

/**
 * Project-standard stringify options for workflow YAML. Established by
 * Phase 0 Spike D. Always pass these to `Document.toString()` on the
 * save path; never call `toString()` without them.
 */
export const WORKFLOW_YAML_STRINGIFY_OPTIONS: ToStringOptions = {
  lineWidth: 0,
  flowCollectionPadding: false,
};

/**
 * Parse a workflow YAML string into a CST-preserving Document. Always
 * returns a Document; malformed input populates `doc.errors[]` rather
 * than throwing.
 */
export function parseAsCst(yaml: string): Document {
  return parseDocument(yaml, {
    keepSourceTokens: true,
  });
}

/**
 * Serialize a Document back to YAML using the project-standard options.
 */
export function stringifyCst(doc: Document): string {
  return doc.toString(WORKFLOW_YAML_STRINGIFY_OPTIONS);
}

/**
 * Semantic equality: parse both strings and compare their plain-JS
 * representations. Bypasses formatting differences (whitespace,
 * quote style, flow vs. block) but catches any actual data change.
 *
 * Used by the ADR-11 round-trip gate and by mutator tests verifying
 * that a single IRPatch produced the expected IR-level outcome.
 */
export function semanticEqual(a: string, b: string): boolean {
  // Guard against malformed input on either side. parseDocument can
  // throw on hostile YAML (anchor cycles, ridiculous depth, etc.) and
  // a function named "semanticEqual" should not propagate that —
  // callers (round-trip gate, banner click handlers) treat it as a
  // pure boolean check (auditor finding).
  try {
    const aJs = parseDocument(a).toJS({ maxAliasCount: -1 });
    const bJs = parseDocument(b).toJS({ maxAliasCount: -1 });
    return deepEqual(aJs, bJs);
  } catch {
    return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(ao[k], bo[k]));
}
