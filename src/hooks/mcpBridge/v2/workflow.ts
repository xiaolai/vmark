/**
 * Purpose: `vmark.workflow.{apply_patch, validate}` handlers — the
 *   only structural mutators that survive the MCP prune.
 *
 *   `apply_patch` accepts an array of IRPatch objects (the existing
 *   discriminated union from `lib/ghaWorkflow/save/mutators.ts`) and
 *   applies them through the CST-safe path so YAML comments, anchors,
 *   and key order are preserved. `validate` runs actionlint and
 *   forwards diagnostics.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md ADR-5.
 *
 * Key decisions:
 *   - `IRPatch` is a public contract once exposed via MCP. We accept
 *     the existing shape verbatim; future breaking changes bump to
 *     `apply_patch_v2`. Validate the discriminator client-side and
 *     return INVALID_PATCH when the shape is wrong.
 *   - `validate` uses the same actionlint wrapper the live editor
 *     uses, so diagnostics surface identically across UI and MCP.
 *   - Only `yaml-workflow` tabs accept `apply_patch`. Markdown tabs
 *     return NOT_WORKFLOW — the AI must fall back to `document.write`.
 *
 * @coordinates-with lib/ghaWorkflow/save/cstParser.ts — parseAsCst / stringifyCst
 * @coordinates-with lib/ghaWorkflow/save/mutators.ts — applyPatch + IRPatch types
 * @coordinates-with lib/ghaWorkflow/lint/actionlint.ts — lintWithActionlint
 * @coordinates-with stores/revisionStore.ts — STALE detection
 * @module hooks/mcpBridge/v2/workflow
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/revisionStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import {
  parseAsCst,
  stringifyCst,
} from "@/lib/ghaWorkflow/save/cstParser";
import { applyPatch, type IRPatch } from "@/lib/ghaWorkflow/save/mutators";
import { lintWithActionlint } from "@/lib/ghaWorkflow/lint/actionlint";
import { respond } from "../utils";
import { v2ErrorString } from "./types";
import type { V2Error } from "./types";

const VALID_PATCH_KINDS: ReadonlySet<string> = new Set([
  "workflow.set",
  "job.set",
  "step.set",
  "with.set",
  "with.remove",
  "needs.add",
  "needs.remove",
  "trigger.setFilters",
]);

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

/**
 * Validate that `value` looks like an `IRPatch[]` we can dispatch.
 * The shape check is structural — runtime YAML clients can't import
 * the TypeScript type so we duck-type the discriminator.
 */
function validatePatches(value: unknown): IRPatch[] | V2Error {
  if (!Array.isArray(value)) {
    return {
      error: "INVALID_PATCH",
      message: "patches must be an array",
    };
  }
  for (const [i, p] of value.entries()) {
    if (!p || typeof p !== "object") {
      return {
        error: "INVALID_PATCH",
        message: `patches[${i}] must be an object`,
      };
    }
    const kind = (p as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !VALID_PATCH_KINDS.has(kind)) {
      return {
        error: "INVALID_PATCH",
        message: `patches[${i}].kind is missing or invalid: ${String(kind)}`,
      };
    }
  }
  return value as IRPatch[];
}

interface WorkflowTab {
  tabId: string;
  filePath: string | null;
  content: string;
}

function resolveWorkflowTab(
  tabIdArg: string | undefined,
): WorkflowTab | V2Error {
  const tabState = useTabStore.getState();
  const docState = useDocumentStore.getState();

  let tabId: string;
  if (tabIdArg) {
    if (
      !Object.values(tabState.tabs).some((list) =>
        list.some((t) => t.id === tabIdArg),
      )
    ) {
      return { error: "INVALID_TAB", message: "Unknown tabId" };
    }
    tabId = tabIdArg;
  } else {
    const focused = getCurrentWindowLabel();
    const active = tabState.activeTabId[focused];
    if (!active) return { error: "INVALID_TAB", message: "No focused tab" };
    tabId = active;
  }

  const doc = docState.documents[tabId];
  if (!doc) return { error: "INVALID_TAB", message: "No document for tab" };

  const isWorkflow =
    looksLikeWorkflowPath(doc.filePath ?? undefined) ||
    isWorkflowYaml(doc.content);
  if (!isWorkflow) {
    return {
      error: "NOT_WORKFLOW",
      message:
        "Tab is not a GitHub Actions workflow YAML; use document.write instead",
    };
  }

  return { tabId, filePath: doc.filePath, content: doc.content };
}

/**
 * Handle `vmark.workflow.apply_patch`.
 *
 * Args: `{tabId?, patches: IRPatch[], expected_revision?}`.
 */
export async function handleWorkflowApplyPatch(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const expectedRevision =
      typeof args.expected_revision === "string"
        ? args.expected_revision
        : undefined;

    const patchesOrError = validatePatches(args.patches);
    if (!Array.isArray(patchesOrError)) {
      await structuredError(id, patchesOrError);
      return;
    }
    const patches = patchesOrError;

    const tabOrError = resolveWorkflowTab(tabIdArg);
    if ("error" in tabOrError) {
      await structuredError(id, tabOrError);
      return;
    }

    const revisionStore = useRevisionStore.getState();
    if (
      expectedRevision !== undefined &&
      !revisionStore.isCurrentRevision(expectedRevision)
    ) {
      await structuredError(id, {
        error: "STALE",
        message: "Document has changed since the last read",
        current_revision: revisionStore.getRevision(),
      });
      return;
    }

    let nextContent: string;
    try {
      const cst = parseAsCst(tabOrError.content);
      for (const patch of patches) {
        applyPatch(cst, patch);
      }
      nextContent = stringifyCst(cst);
    } catch (e) {
      await structuredError(id, {
        error: "INVALID_PATCH",
        message: `Patch application failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
      return;
    }

    if (nextContent === tabOrError.content) {
      // No-op patch batch — don't bump revision.
      await respond({
        id,
        success: true,
        data: { revision: revisionStore.getRevision() },
      });
      return;
    }

    useDocumentStore.getState().setContent(tabOrError.tabId, nextContent);
    revisionStore.updateRevision();

    await respond({
      id,
      success: true,
      data: { revision: revisionStore.getRevision() },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle `vmark.workflow.validate`. Args: `{tabId?: string}`.
 *
 * Runs actionlint over the workflow YAML and returns diagnostics.
 * Markdown tabs return `NOT_WORKFLOW`.
 */
export async function handleWorkflowValidate(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const tabOrError = resolveWorkflowTab(tabIdArg);
    if ("error" in tabOrError) {
      await structuredError(id, tabOrError);
      return;
    }
    const outcome = await lintWithActionlint(tabOrError.content);
    const diagnostics = outcome.diagnostics.map((d) => ({
      line: d.position?.startLine ?? 0,
      col: d.position?.startCol ?? 0,
      message: d.message,
      severity: d.severity,
    }));
    await respond({
      id,
      success: true,
      data: {
        ok: diagnostics.length === 0 && !outcome.error,
        diagnostics,
        binaryAvailable: outcome.binaryAvailable,
        error: outcome.error,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
