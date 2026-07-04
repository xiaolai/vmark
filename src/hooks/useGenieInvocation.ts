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
 *   - Abort handled via aiInvocationStore cancel flag
 *   - Workflow genies route to run_workflow instead of run_ai_prompt
 *
 * @coordinates-with genieInvocation/streamRunner.ts — provider validation + streaming
 * @coordinates-with genieInvocation/extraction.ts — scope extraction + templating
 * @coordinates-with aiSuggestionStore.ts — stores the suggestion for accept/reject
 * @coordinates-with geniesStore.ts — provides genie definitions and templates
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
import { extractContent, formatContext, fillTemplate } from "./genieInvocation/extraction";
import { runGenieStream } from "./genieInvocation/streamRunner";

/**
 * WI-7.1: workflow genies dispatch through run_workflow instead of
 * run_ai_prompt. The picker still shows them inline; invocation routes
 * the YAML body to the Rust runner.
 */
async function runWorkflowGenie(genie: GenieDefinition): Promise<void> {
  const hasProvider = await useAiProviderStore.getState().ensureProvider();
  if (!hasProvider) {
    toast.error(i18n.t("dialog:toast.genieNoProvider"));
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const provState = useAiProviderStore.getState();
    const active = provState.activeProvider;
    const rest = active ? provState.restProviders.find((p) => p.type === active) : null;
    const cli = active ? provState.cliProviders.find((p) => p.type === active) : null;
    const provider = active
      ? {
          provider: active,
          apiKey: rest?.apiKey || null,
          endpoint: rest?.endpoint || null,
          cliPath: cli?.path || null,
        }
      : null;
    const { useWorkspaceStore } = await import("@/stores/workspaceStore");
    const workspaceRoot = useWorkspaceStore.getState().rootPath ?? "";
    if (!workspaceRoot) {
      toast.error(i18n.t("dialog:toast.workflowNeedsWorkspace", "Open a workspace first"));
      return;
    }
    const { useWorkflowStore } = await import("@/stores/workflowStore");
    // Pre-generate the execution id and register it BEFORE invoking the
    // runner (WI-0.3, C2). A fast workflow can emit step-update/complete
    // events before invoke() resolves; if executionId is still unset when
    // they arrive, they are processed against a null id and then wiped by
    // a late setExecution — losing progress / sticking on "running".
    // Mirrors useWorkflowExecution.start.
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    useWorkflowStore.getState().setExecution(id);
    try {
      await invoke<string>("run_workflow", {
        yaml: genie.template,
        env: {},
        workspaceRoot,
        provider,
        executionId: id,
      });
    } catch (err) {
      // Roll the store back so the UI doesn't show a fake "running" state.
      useWorkflowStore.getState().setExecution(null);
      throw err;
    }
    useGeniesStore.getState().addRecent(genie.metadata.name);
  } catch (err) {
    toast.error(String(err));
  }
}

/** Shared preconditions for prompt genies: not in source mode, provider available. */
async function checkPromptPreconditions(): Promise<boolean> {
  // Block in Source Mode — suggestions can only apply via Tiptap
  if (useUIStore.getState().sourceMode) {
    toast.info(i18n.t("dialog:toast.genieNotInSourceMode"));
    return false;
  }
  // Auto-detect provider if none selected
  const hasProvider = await useAiProviderStore.getState().ensureProvider();
  if (!hasProvider) {
    toast.error(i18n.t("dialog:toast.genieNoProvider"));
    return false;
  }
  return true;
}

export function useGenieInvocation() {
  const isRunning = useAiInvocationStore((s) => s.isRunning);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const cancel = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    useAiInvocationStore.getState().cancel();
  }, []);

  // Cancel running invocation on unmount (releases lock + unlistens)
  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  // Listen for MCP bridge genie invocation requests (fired from genieHandlers.ts)
  const invokeGenieRef = useRef<((genie: GenieDefinition, scopeOverride?: GenieScope) => Promise<void>) | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        id: string;
        genie: GenieDefinition;
        scopeOverride?: GenieScope;
        handled?: boolean;
      };
      // Synchronous handshake with genieHandlers.handleGeniesInvoke: flip
      // `handled` before returning so the MCP bridge can distinguish a real
      // invocation from a dropped one (no listener mounted).
      detail.handled = true;
      invokeGenieRef.current?.(detail.genie, detail.scopeOverride);
    };
    window.addEventListener("mcp:invoke-genie", handler);
    return () => window.removeEventListener("mcp:invoke-genie", handler);
  }, []);

  const invokeGenie = useCallback(
    async (genie: GenieDefinition, scopeOverride?: GenieScope) => {
      if (genie.kind === "workflow") {
        await runWorkflowGenie(genie);
        return;
      }

      if (!(await checkPromptPreconditions())) return;

      const scope = scopeOverride ?? genie.metadata.scope;
      const contextRadius = genie.metadata.context ?? 0;
      const extracted = extractContent(scope, contextRadius);
      if (!extracted) {
        genieWarn("No content to extract for scope:", scope);
        toast.info(i18n.t("dialog:toast.genieNoContent"));
        return;
      }

      // Build context string only if template uses {{context}}
      const hasContextVar = /\{\{\s*context\s*\}\}/.test(genie.template);
      /* v8 ignore start -- ?? fallbacks are defensive; context fields may be undefined */
      const contextStr = hasContextVar
        ? formatContext(extracted.contextBefore ?? "", extracted.contextAfter ?? "")
        : undefined;
      /* v8 ignore stop */

      const filled = fillTemplate(genie.template, extracted.text, contextStr);

      // Track genie as recent
      useGeniesStore.getState().addRecent(genie.metadata.name);

      await runGenieStream({
        filledPrompt: filled,
        extraction: extracted,
        model: genie.metadata.model,
        action: genie.metadata.action ?? "replace",
        processingLabel: genie.metadata.name,
        listenerRef: unlistenRef,
      });
    },
    []
  );

  // eslint-disable-next-line react-hooks/refs -- render-synced so the synchronous MCP bridge handler sees the latest invokeGenie before passive effects run (#1063)
  invokeGenieRef.current = invokeGenie;

  const invokeFreeform = useCallback(
    async (userPrompt: string, scope: GenieScope) => {
      if (!(await checkPromptPreconditions())) return;

      // Auto-include ±1 context for selection/block scope
      const contextRadius = scope !== "document" ? 1 : 0;
      const extracted = extractContent(scope, contextRadius);
      if (!extracted) {
        genieWarn("No content to extract for scope:", scope);
        toast.info(i18n.t("dialog:toast.genieNoContent"));
        return;
      }

      const hasContext = extracted.contextBefore || extracted.contextAfter;
      let filled: string;
      if (hasContext) {
        /* v8 ignore start -- ?? fallbacks are defensive; context fields may be undefined */
        const ctx = formatContext(extracted.contextBefore ?? "", extracted.contextAfter ?? "");
        /* v8 ignore stop */
        filled = `${userPrompt}\n\n## Context (do not modify):\n${ctx}\n\n## Content:\n${extracted.text}`;
      } else {
        filled = `${userPrompt}\n\n${extracted.text}`;
      }
      await runGenieStream({
        filledPrompt: filled,
        extraction: extracted,
        action: "replace",
        processingLabel: userPrompt,
        listenerRef: unlistenRef,
      });
    },
    []
  );

  return { invokeGenie, invokeFreeform, isRunning, cancel };
}
