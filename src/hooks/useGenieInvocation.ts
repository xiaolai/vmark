/**
 * Genie Invocation Hook
 *
 * Purpose: Orchestrates the full AI genie pipeline — extracts content from
 *   the editor, fills the genie template, invokes the AI provider via Rust,
 *   streams the response, and either creates a suggestion for user approval
 *   or applies changes directly when auto-approve is enabled.
 *
 * Pipeline: User triggers genie → extractContent(scope) → fillTemplate()
 *   → runGenieStream() [genieInvocation/streamRunner.ts]: invoke +
 *   listen("ai:response") → accumulate → if autoApprove: apply directly
 *   → else: aiSuggestionStore.createSuggestion() → user accepts/rejects
 *
 * Key decisions:
 *   - Content extraction supports document/selection/block/paragraph scopes
 *     (genieInvocation/extraction.ts)
 *   - Streaming via Tauri events (not WebSocket) for reliability
 *   - Cancel drops the stream listener AND asks Rust to stop the provider
 *     (cancelGenieRequest → cancel_ai_prompt, keyed by the store's request
 *     id, read before the reset clears it — audit #375)
 *   - A cancel that arrives BEFORE the request registers still counts: the run
 *     captures `cancelEpoch` up front and `tryStart` refuses it, so a click
 *     during `ensureProvider()` or the `listen()` round-trip stops the
 *     dispatch instead of silently letting the provider run (audit #375)
 *   - Workflow genies route to run_workflow instead of run_ai_prompt
 *   - Genie and freeform invocations share one prompt pipeline
 *     (runPromptGenie); only the prompt plan differs
 *
 * @coordinates-with genieInvocation/streamRunner.ts — provider validation + streaming
 * @coordinates-with genieInvocation/cancelRequest.ts — asks Rust to stop the provider on cancel
 * @coordinates-with services/workflow/providerPayload.ts — the shared run_workflow provider block
 * @coordinates-with genieInvocation/extraction.ts — scope extraction + templating
 * @coordinates-with stores/aiStore/suggestion.ts — stores the suggestion for accept/reject
 * @coordinates-with stores/aiStore/genies.ts — provides genie definitions and templates
 * @coordinates-with geniePickerStore.ts — feeds mode/response state for picker UI
 * @module hooks/useGenieInvocation
 */

import { useCallback, useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import type { GenieDefinition, GenieScope } from "@/types/aiGenies";
import { useAiProviderStore } from "@/stores/aiStore";
import { useAiInvocationStore } from "@/stores/aiStore";
import { useUIStore } from "@/stores/uiStore";
import { useGeniesStore } from "@/stores/aiStore";
import { genieWarn } from "@/utils/debug";
import { commandErrorMessage } from "@/services/commands/commandError";
import { safeUnlisten } from "@/utils/safeUnlisten";
import {
  extractContent,
  formatContext,
  fillTemplate,
  type ExtractionResult,
} from "@/services/genieInvocation/extraction";
import { runGenieStream, type RunGenieStreamOptions } from "@/services/genieInvocation/streamRunner";
import { cancelGenieRequest } from "@/services/genieInvocation/cancelRequest";
import {
  workflowProviderPayload,
  type WorkflowProviderPayload,
} from "@/services/workflow/providerPayload";

/**
 * Register an execution id, then run the workflow under it.
 *
 * The id is generated and registered BEFORE invoking the runner (WI-0.3, C2):
 * a fast workflow can emit step-update/complete events before invoke()
 * resolves; if executionId were still unset when they arrived, they would be
 * processed against a null id and then wiped by a late setExecution — losing
 * progress / sticking on "running". Mirrors useWorkflowExecution.start. A
 * rejected dispatch rolls the registration back — only while the store still
 * holds THIS execution (audit #374): a workflow registered after this one must
 * not be wiped by its failure.
 *
 * The registration slot holds ONE run per window, so a second invocation is
 * refused rather than allowed to overwrite it (audit #728). Overwriting made
 * the live run's own events unroutable and cleared its progress, while BOTH
 * backend workflows carried on running.
 */
async function dispatchWorkflow(
  yaml: string,
  workspaceRoot: string,
  provider: WorkflowProviderPayload | null,
): Promise<"dispatched" | "already-running"> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { useWorkflowStore } = await import("@/stores/workflowStore");
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Checked and claimed with no await between, so two clicks in one tick
  // cannot both pass it.
  if (useWorkflowStore.getState().preview.executionId !== null) return "already-running";
  useWorkflowStore.getState().setExecution(id);
  try {
    await invoke<string>("run_workflow", { yaml, env: {}, workspaceRoot, provider, executionId: id });
  } catch (err) {
    const store = useWorkflowStore.getState();
    if (store.preview.executionId === id) store.setExecution(null);
    throw err;
  }
  return "dispatched";
}

/**
 * WI-7.1: workflow genies dispatch through run_workflow instead of
 * run_ai_prompt. The picker still shows them inline; invocation routes
 * the YAML body to the Rust runner. Provider resolution and the
 * register/dispatch/rollback step are the helpers above (audit #373).
 */
async function runWorkflowGenie(genie: GenieDefinition): Promise<void> {
  const hasProvider = await useAiProviderStore.getState().ensureProvider();
  if (!hasProvider) {
    toast.error(i18n.t("dialog:toast.genieNoProvider"));
    return;
  }
  try {
    const { useWorkspaceStore } = await import("@/stores/workspaceStore");
    const workspaceRoot = useWorkspaceStore.getState().rootPath ?? "";
    if (!workspaceRoot) {
      toast.error(i18n.t("dialog:toast.workflowNeedsWorkspace", "Open a workspace first"));
      return;
    }
    const outcome = await dispatchWorkflow(
      genie.template,
      workspaceRoot,
      workflowProviderPayload(),
    );
    if (outcome === "already-running") {
      toast.error(i18n.t("dialog:toast.workflowAlreadyRunning"));
      return;
    }
    useGeniesStore.getState().addRecent(genie.metadata.name);
  } catch (err) {
    // `run_workflow` returns a typed CommandError since WI-19 (feature-disabled
    // when the engine is off, invalid-input for bad YAML). `String(err)` on that
    // object renders the literal "[object Object]" — the exact defect
    // commandErrorMessage exists to close.
    toast.error(commandErrorMessage(err));
  }
}

/** Block in Source Mode — a suggestion can only be applied through Tiptap. */
function notInSourceMode(): boolean {
  if (!useUIStore.getState().sourceMode) return true;
  toast.info(i18n.t("dialog:toast.genieNotInSourceMode"));
  return false;
}

/** Shared preconditions for prompt genies: not in source mode, provider available. */
async function checkPromptPreconditions(): Promise<boolean> {
  if (!notInSourceMode()) return false;
  // Auto-detect provider if none selected
  const hasProvider = await useAiProviderStore.getState().ensureProvider();
  if (!hasProvider) {
    toast.error(i18n.t("dialog:toast.genieNoProvider"));
    return false;
  }
  // Asked AGAIN after the await (audit #729). Provider detection spawns a
  // process and can take seconds; F6 during that wait left the check answered
  // for a surface that is no longer mounted, and the extraction and Tiptap
  // application below went ahead against the editor the user had just left.
  return notInSourceMode();
}

/** What a prompt plan contributes once the content is extracted: the prompt and how to run it. */
type PromptPlan = Omit<RunGenieStreamOptions, "extraction" | "listenerRef" | "cancelEpoch">;

/**
 * The prompt pipeline shared by genie and freeform invocations (audit #377):
 * preconditions → extraction → prompt → stream. Only `plan` differs between
 * the two — the prompt and the run options it derives from the extraction.
 */
async function runPromptGenie(
  scope: GenieScope,
  contextRadius: number,
  listenerRef: RunGenieStreamOptions["listenerRef"],
  plan: (extracted: ExtractionResult) => PromptPlan,
): Promise<boolean> {
  // Taken FIRST, before `ensureProvider()` can await (audit #375): a cancel
  // during that wait has no request id to name, so this epoch is the only
  // record that the user already said no.
  const cancelEpoch = useAiInvocationStore.getState().cancelEpoch;
  if (!(await checkPromptPreconditions())) return false;
  const extracted = extractContent(scope, contextRadius);
  if (!extracted) {
    genieWarn("No content to extract for scope:", scope);
    toast.info(i18n.t("dialog:toast.genieNoContent"));
    return false;
  }
  return runGenieStream({ ...plan(extracted), extraction: extracted, listenerRef, cancelEpoch });
}

export function useGenieInvocation() {
  const isRunning = useAiInvocationStore((s) => s.isRunning);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const cancel = useCallback(() => {
    // Through safeUnlisten (audit #732). Tauri TYPES `UnlistenFn` as
    // `() => void` while the implementation is async, so a failing unlisten
    // hands back a rejected promise that no synchronous try/catch can see —
    // an unhandled rejection on the cancel path. The ref is cleared either
    // way: a listener we could not remove is still not ours to release twice.
    safeUnlisten(unlistenRef.current);
    unlistenRef.current = null;
    // Reach the provider, not just our listener (audit #375) — read the id
    // BEFORE the store reset clears it.
    const { requestId } = useAiInvocationStore.getState();
    if (requestId) cancelGenieRequest(requestId);
    useAiInvocationStore.getState().cancel();
  }, []);

  // Cancel running invocation on unmount (releases lock + unlistens)
  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  const invokeGenie = useCallback(
    async (genie: GenieDefinition, scopeOverride?: GenieScope) => {
      if (genie.kind === "workflow") {
        await runWorkflowGenie(genie);
        return;
      }

      const scope = scopeOverride ?? genie.metadata.scope;
      const dispatched = await runPromptGenie(scope, genie.metadata.context ?? 0, unlistenRef, (extracted) => {
        // Build context string only if template uses {{context}}
        const hasContextVar = /\{\{\s*context\s*\}\}/.test(genie.template);
        /* v8 ignore start -- ?? fallbacks are defensive; context fields may be undefined */
        const contextStr = hasContextVar
          ? formatContext(extracted.contextBefore ?? "", extracted.contextAfter ?? "")
          : undefined;
        /* v8 ignore stop */

        return {
          filledPrompt: fillTemplate(genie.template, extracted.text, contextStr),
          model: genie.metadata.model,
          action: genie.metadata.action ?? "replace",
          processingLabel: genie.metadata.name,
        };
      });
      // Recency records that the genie RAN (audit #730). It used to be written
      // inside the plan callback, which is evaluated as an argument — before
      // provider validation and before the invocation lock — so a genie
      // refused for a missing API key, or because another run held the lock,
      // still became the most recent one. `runWorkflowGenie` already recorded
      // it after its dispatch; this is the same rule for the prompt path.
      if (dispatched) useGeniesStore.getState().addRecent(genie.metadata.name);
    },
    []
  );

  const invokeFreeform = useCallback(
    async (userPrompt: string, scope: GenieScope) => {
      // Auto-include ±1 context for selection/block scope
      await runPromptGenie(scope, scope !== "document" ? 1 : 0, unlistenRef, (extracted) => {
        const hasContext = extracted.contextBefore || extracted.contextAfter;
        let filledPrompt: string;
        if (hasContext) {
          /* v8 ignore start -- ?? fallbacks are defensive; context fields may be undefined */
          const ctx = formatContext(extracted.contextBefore ?? "", extracted.contextAfter ?? "");
          /* v8 ignore stop */
          filledPrompt = `${userPrompt}\n\n## Context (do not modify):\n${ctx}\n\n## Content:\n${extracted.text}`;
        } else {
          filledPrompt = `${userPrompt}\n\n${extracted.text}`;
        }
        return { filledPrompt, action: "replace", processingLabel: userPrompt };
      });
    },
    []
  );

  return { invokeGenie, invokeFreeform, isRunning, cancel };
}
