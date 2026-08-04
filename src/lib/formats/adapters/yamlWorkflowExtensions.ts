/**
 * GitHub Actions source-editor extensions for the YAML adapter.
 *
 * Purpose: load the four CodeMirror extensions the GHA workflow experience
 *   needs — IR sync, `${{ }}` completion, cursor↔canvas sync, `uses:` goto-def
 *   — as SEPARATE, individually-degradable chunks.
 *
 * Split out of `yaml.tsx` to keep that file inside the ~300-line gate, and
 * because per-extension failure handling is more code than an adapter's
 * declaration block should carry.
 *
 * Key decisions (audit 20260804-F8):
 *   - Each import is INDIVIDUALLY guarded. They used to share one
 *     `Promise.all`, so a single failed chunk rejected `loadExtraExtensions`
 *     wholesale and the user lost completion AND cursor sync AND goto-def —
 *     three features for one bad fetch, with nothing logged.
 *   - A failure DEGRADES, it never throws. The source pane keeps YAML
 *     highlighting, lint and editing; what is lost is authoring help.
 *   - Each failure is reported ONCE per extension, naming it and saying the
 *     editor continues without it. Repeating per tab-open would bury it, and
 *     "completion stopped working" is otherwise indistinguishable from
 *     "completion has nothing to offer here" — these extensions are all
 *     no-ops until the document is actually a workflow.
 *   - Store access is bound HERE rather than inside the plugins, which must
 *     stay store-free (lint:store-coupling).
 *   - The four chunk loaders are an injectable PARAMETER with a production
 *     default. Degradation is behavior, and behavior wants a seam: faking it
 *     through the module registry does not work, because vitest caches a
 *     module once it resolves, so a chunk that succeeded in one case can
 *     never be made to fail in the next.
 *
 * @coordinates-with lib/formats/adapters/yaml.tsx — the adapter that declares them
 * @module lib/formats/adapters/yamlWorkflowExtensions
 */
import type { Extension } from "@codemirror/state";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkflowStore } from "@/stores/workflowStore";
import { formatsWarn, workflowWarn } from "@/utils/debug";

interface SourceExtrasContext {
  tabId: string;
  filePath: string | null;
  windowLabel: string;
}

/** The four chunks, each loadable (and failable) on its own. */
export interface WorkflowExtensionLoaders {
  irSync: () => Promise<typeof import("@/plugins/codemirror/sourceGhaIrSync")>;
  completion: () => Promise<typeof import("@/plugins/codemirror/sourceWorkflowCompletion")>;
  cursorSync: () => Promise<typeof import("@/plugins/codemirror/sourceWorkflowCursorSync")>;
  goto: () => Promise<typeof import("@/plugins/codemirror/sourceWorkflowGoto")>;
}

/** What ships: the real dynamic imports. */
const productionLoaders: WorkflowExtensionLoaders = {
  irSync: () => import("@/plugins/codemirror/sourceGhaIrSync"),
  completion: () => import("@/plugins/codemirror/sourceWorkflowCompletion"),
  cursorSync: () => import("@/plugins/codemirror/sourceWorkflowCursorSync"),
  goto: () => import("@/plugins/codemirror/sourceWorkflowGoto"),
};

/** Extension ids already reported as unavailable — one line each, ever. */
const reportedFailures = new Set<string>();

/** Test seam: forget which failures have been reported. */
export function __resetWorkflowExtensionReports(): void {
  reportedFailures.clear();
}

/**
 * Load one optional extension chunk. Resolves to `null` — never rejects — so
 * a missing chunk costs exactly the feature it belongs to.
 */
async function loadOptional<T>(name: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (!reportedFailures.has(name)) {
      reportedFailures.add(name);
      formatsWarn(
        `GitHub Actions source extension "${name}" failed to load; the YAML editor ` +
          "continues without it (highlighting, lint and editing are unaffected)",
        error,
      );
    }
    return null;
  }
}

/**
 * The GHA extensions available in this session, in adapter order. Whatever
 * loaded is returned; whatever did not is absent, logged, and not fatal.
 */
export async function loadWorkflowSourceExtensions(
  { tabId, filePath, windowLabel }: SourceExtrasContext,
  loaders: WorkflowExtensionLoaders = productionLoaders,
): Promise<Extension[]> {
  const [irSync, completion, cursorSync, goto] = await Promise.all([
    loadOptional("gha-ir-sync", loaders.irSync),
    loadOptional("workflow-completion", loaders.completion),
    loadOptional("workflow-cursor-sync", loaders.cursorSync),
    // Goto-def needs a real file path to resolve local `uses:` refs against;
    // without one there is nothing to load and nothing to report.
    filePath ? loadOptional("workflow-goto", loaders.goto) : Promise.resolve(null),
  ]);

  const extensions: Extension[] = [];

  if (irSync) {
    // The IR-sync extension is the sole production writer of the workflowStore
    // `gha` slice; completion and cursor sync read it (both no-op until it
    // holds a workflow, so plain YAML tabs pay nothing).
    extensions.push(
      irSync.ghaIrSyncExtension({
        getFilePath: () => useDocumentStore.getState().documents?.[tabId]?.filePath ?? null,
        publish: (workflow) => useWorkflowStore.getState().setGhaWorkflow(tabId, workflow),
      }),
    );
  }
  if (completion) extensions.push(completion.workflowCompletionExtension(tabId));
  if (cursorSync) extensions.push(cursorSync.workflowCursorSyncExtension(tabId));
  if (goto && filePath) {
    extensions.push(
      goto.gotoExtension({
        filePath,
        windowLabel,
        onOpenFailure: (reason) => {
          workflowWarn(`[gha goto-def] could not open local target (${reason})`);
        },
      }),
    );
  }

  return extensions;
}
