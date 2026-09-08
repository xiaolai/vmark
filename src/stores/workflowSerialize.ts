/**
 * Applying the edit slice's patch queue to a workflow document's YAML.
 *
 * Purpose: `workflowStore.ts` is the store's WIRING (and sits on its file-size
 * baseline); turning a queue of `IRPatch`es into text is a separate concern
 * with no Zustand in it, the same split `workflowEditQueue.ts` already makes
 * for the queue algebra.
 *
 * NON-THROWING by contract, and it says WHICH failure (audit #991/#1006).
 * Every failure — the document does not parse, a patch cannot be applied, alias
 * expansion is refused — used to return `originalYaml`, so the only signal a
 * caller had was string equality against its own input. That conflates three
 * different things with a legitimate no-op, and left the queue pending forever
 * with nothing able to say why. The result is discriminated now; the queue still
 * survives every failure, and nothing is written.
 *
 * @coordinates-with src/stores/workflowStore.ts — the only consumer
 * @coordinates-with src/lib/ghaWorkflow/save/mutators.ts — applyPatch
 * @module stores/workflowSerialize
 */
import { stringify as yamlStringify } from "yaml";
import {
  parseAsCst,
  stringifyCst,
  WORKFLOW_YAML_STRINGIFY_OPTIONS,
} from "@/lib/ghaWorkflow/save/cstParser";
import { applyPatch, type IRPatch } from "@/lib/ghaWorkflow/save/mutators";
import { useSettingsStore } from "@/stores/settingsStore";

/** The per-document override, or the user's setting when it is unset. */
function resolvePreserve(override: boolean | null): boolean {
  if (override !== null) return override;
  return useSettingsStore.getState().advanced.workflowEditorPreserveYamlFormatting ?? true;
}

/**
 * Bound on YAML alias expansion (audit #1008).
 *
 * `-1` — the previous value — is yaml's "disable the check" setting, and the
 * input reaching this parser is a workflow file the user opened from a
 * workspace, untrusted by the same standard as any other opened document. An
 * anchor bomb could then expand until the renderer ran out of memory. The bound
 * is deliberately generous: far above the alias count any hand-written workflow
 * reaches, far below what exponential expansion needs to hurt. Exceeding it
 * throws, which the caller below reports as `apply-failed`.
 */
const MAX_YAML_ALIAS_COUNT = 10_000;

/**
 * What applying a patch queue to a document produced.
 *
 * The three failure shapes are deliberately distinct even though every one of
 * them leaves the queue intact: the SAME outward behaviour has three different
 * causes, and a caller that cannot tell them apart cannot log a useful line,
 * cannot decide whether a retry could ever succeed, and cannot distinguish any
 * of them from the user having queued an edit that changes nothing.
 */
export type WorkflowSerializeResult =
  /** Applied, and the text changed. */
  | { status: "applied"; yaml: string }
  /** Applied, and the text is byte-identical — a legitimate no-op. */
  | { status: "unchanged" }
  /** Nothing queued. */
  | { status: "no-patches" }
  /** The document does not parse, so no patch could be located in it. */
  | { status: "parse-failed"; detail: string }
  /** A patch could not be applied, or serialization threw (alias bound, …). */
  | { status: "apply-failed"; detail: string };

/** Apply `patches` to `originalYaml`, reporting exactly what happened. */
export function serializeWithPatches(
  originalYaml: string,
  patches: readonly IRPatch[],
  preserveFormatting: boolean | null,
): WorkflowSerializeResult {
  if (patches.length === 0) return { status: "no-patches" };
  let doc;
  try {
    doc = parseAsCst(originalYaml);
  } catch (error) {
    return { status: "parse-failed", detail: errorDetail(error) };
  }
  if (doc.errors.length > 0) {
    return { status: "parse-failed", detail: doc.errors.map((e) => e.message).join("; ") };
  }
  try {
    for (const patch of patches) applyPatch(doc, patch);
    const yaml = resolvePreserve(preserveFormatting)
      ? stringifyCst(doc)
      : yamlStringify(doc.toJS({ maxAliasCount: MAX_YAML_ALIAS_COUNT }), {
          ...WORKFLOW_YAML_STRINGIFY_OPTIONS,
        });
    return yaml === originalYaml ? { status: "unchanged" } : { status: "applied", yaml };
  } catch (error) {
    return { status: "apply-failed", detail: errorDetail(error) };
  }
}

/** A message for a log line — never shown to the user, so no i18n here. */
function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
