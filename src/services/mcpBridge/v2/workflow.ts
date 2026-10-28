/**
 * Purpose: `vmark.workflow.{apply_patch, validate}` handlers — the
 *   only structural mutators that survive the MCP prune.
 *
 *   `apply_patch` accepts an array of IRPatch objects (the existing
 *   discriminated union from `lib/ghaWorkflow/save/mutators.ts`), compiles
 *   them against the tab's text (`workflowPatch.ts`) and writes the result
 *   through the journal. `validate` runs actionlint and forwards diagnostics.
 *
 * Origin: MCP pruning plan (retired) ADR-5.
 *
 * Key decisions:
 *   - `IRPatch` is accepted verbatim; future breaking changes bump to
 *     `apply_patch_v2`.
 *   - `apply_patch` refuses in a fixed order, the first that applies:
 *     addresses, patch shape, tab, tab kind, revision, patch application.
 *     Nothing before the journaled write touches the buffer.
 *   - `validate` uses the same actionlint wrapper the live editor
 *     uses, so diagnostics surface identically across UI and MCP.
 *   - Only `yaml-workflow` tabs accept `apply_patch`. Markdown tabs
 *     return NOT_WORKFLOW — the AI must fall back to `document.write`.
 *   - Both handlers resolve their tab through `tabGuard.ts`, which first
 *     flushes the mounted editors into the store — so a patch is applied to,
 *     and a lint runs over, the text the user actually has, pending
 *     keystrokes included.
 *
 * @coordinates-with tabGuard.ts — tab resolution, the flush, INVALID_TAB and STALE
 * @coordinates-with journaledEdit.ts — the journal protocol `apply_patch` runs (a whole-document barrier)
 * @coordinates-with writeAddresses.ts — the `addresses` shape check; the journal checks the set
 * @coordinates-with workflowPatch.ts — the shape check and the pure compilation of a batch
 * @coordinates-with lib/ghaWorkflow/lint/actionlint.ts — lintWithActionlint
 * @coordinates-with stores/documentStore/revision.ts — the revision token
 * @module services/mcpBridge/v2/workflow
 */

import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { lintWithActionlint } from "@/lib/ghaWorkflow/lint/actionlint";
import { useSettingsStore } from "@/stores/settingsStore";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { readOperationArgs, readOperationArgsChecked } from "./readOperationArgs";
import { requireWriteArgs } from "./writeAddresses";
import {
  requireCurrentRevision,
  requireTab,
  structuredError,
  type GuardedTab,
} from "./tabGuard";
import { runJournaledEdit } from "./journaledEdit";
import { withAdmittedReads, type AdmittedReads } from "./admittedReads";
import { compileWorkflowPatch, validatePatches } from "./workflowPatch";

/**
 * Resolve the request's tab and require it to be a workflow, or answer the
 * refusal (`INVALID_TAB`, `NOT_WORKFLOW`) and return `null`.
 */
async function requireWorkflowTab(
  id: string,
  tabIdArg: string | undefined,
): Promise<GuardedTab | null> {
  const tab = await requireTab(id, tabIdArg);
  if (!tab) return null;
  if (tab.kind !== "yaml-workflow") {
    await structuredError(id, {
      error: "NOT_WORKFLOW",
      message:
        "Tab is not a GitHub Actions workflow YAML; use document.write instead",
    });
    return null;
  }
  return tab;
}

/** What the journaled write of a patched workflow carries besides its text. */
interface PatchedWrite {
  requireFocus: boolean;
  addressed: { addresses?: string[] };
  context: McpWriteContext;
  reads: AdmittedReads;
}

/**
 * Write `text` over the tab through the edit journal's controlled-mutation
 * protocol (`journaledEdit.ts`), bumping the revision last, and answer
 * `applied` + `durable`; a refusal is answered by the journal.
 */
async function writePatchedText(id: string, tab: GuardedTab, text: string, w: PatchedWrite): Promise<void> {
  const revisionStore = useRevisionStore.getState();
  const outcome = await runJournaledEdit(id, {
    tab,
    preimage: tab.content,
    requireFocus: w.requireFocus,
    tool: "workflow.apply_patch",
    target: text,
    ...w.addressed,
    context: w.context,
    reads: w.reads,
    apply: () => {
      useDocumentStore.getState().setEditorContent(tab.tabId, text);
      // Bumped here, last, so the token returned is the document's newest.
      const revisionAfter = revisionStore.updateRevision(tab.tabId);
      const postimage = useDocumentStore.getState().documents[tab.tabId]?.content ?? text;
      return { postimage, value: revisionAfter };
    },
  });
  if (!outcome) return;
  await respond({
    id,
    success: true,
    data: { revision: outcome.value, applied: true, durable: outcome.durable },
  });
}

/**
 * Handle `vmark.workflow.apply_patch`.
 *
 * Args: `{tabId?, patches: IRPatch[], expected_revision?, addresses?}`.
 *
 * Runs through the edit journal's controlled-mutation protocol
 * (`journaledEdit.ts`) and answers `applied` + `durable`; `context` is the
 * revision's actor. A no-op patch batch journals nothing.
 */
export async function handleWorkflowApplyPatch(
  id: string,
  args: Record<string, unknown>,
  context: McpWriteContext,
): Promise<void> {
  return wrapHandler(id, () => withAdmittedReads(context, async (reads) => {
    const checked = readOperationArgsChecked("vmark.workflow.apply_patch", args);
    const { wire } = checked;
    const addressed = await requireWriteArgs(id, checked);
    if (!addressed) return;

    const patches = validatePatches(wire.patches);
    if (!Array.isArray(patches)) {
      await structuredError(id, patches);
      return;
    }

    const tab = await requireWorkflowTab(id, wire.tabId);
    if (!tab) return;
    if (!(await requireCurrentRevision(id, tab.tabId, wire.expected_revision))) return;

    const compiled = compileWorkflowPatch(tab.content, patches);
    if (compiled.status === "refused") {
      await structuredError(id, compiled.error);
      return;
    }
    if (compiled.status === "unchanged") {
      // No-op patch batch — don't bump revision.
      await respond({ id, success: true, data: { revision: useRevisionStore.getState().getRevision(tab.tabId) } });
      return;
    }
    await writePatchedText(id, tab, compiled.text, { requireFocus: !wire.tabId, addressed, context, reads });
  }));
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
  return wrapHandler(id, async () => {
    const wire = readOperationArgs("vmark.workflow.validate", args);
    const tab = await requireWorkflowTab(id, wire.tabId);
    if (!tab) return;
    if (!useSettingsStore.getState().advanced.workflowActionlint) {
      await respond({
        id,
        success: true,
        data: {
          ok: true,
          diagnostics: [],
          binaryAvailable: false,
          error: "actionlint disabled in settings",
        },
      });
      return;
    }
    const outcome = await lintWithActionlint(tab.content);
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
  });
}
