/**
 * Genie Invocation Hook
 *
 * Purpose: Orchestrates the full AI genie pipeline — extracts content from
 *   the editor, fills the genie template, invokes the AI provider via Rust,
 *   streams the response, and either creates a suggestion for user approval
 *   or applies changes directly when auto-approve is enabled.
 *
 * Pipeline: User triggers genie → extractContent(scope) → fillTemplate()
 *   → invoke("stream_ai_response") → listen("ai:response") → accumulate
 *   → if autoApprove: apply directly via createMarkdownPasteSlice
 *   → else: aiSuggestionStore.createSuggestion() → user accepts/rejects
 *
 * Key decisions:
 *   - Content extraction supports document/selection/block/paragraph scopes
 *   - Source peek range used for block-level extraction in source mode
 *   - Streaming via Tauri events (not WebSocket) for reliability
 *   - Abort handled via aiInvocationStore cancel flag
 *   - REST vs non-REST providers handled by aiProviderStore type check
 *
 * @coordinates-with aiSuggestionStore.ts — stores the suggestion for accept/reject
 * @coordinates-with aiProviderStore.ts — provides API key and provider config
 * @coordinates-with geniesStore.ts — provides genie definitions and templates
 * @coordinates-with geniePickerStore.ts — feeds mode/response state for picker UI
 * @module hooks/useGenieInvocation
 */

import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type { GenieDefinition, GenieScope, GenieAction, AiResponseChunk } from "@/types/aiGenies";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { useAiProviderStore, REST_TYPES, KEY_OPTIONAL_REST } from "@/stores/aiProviderStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAiInvocationStore } from "@/stores/aiInvocationStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { useGeniesStore } from "@/stores/geniesStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { getExpandedSourcePeekRange, serializeSourcePeekRange } from "@/utils/sourcePeek";
import { extractSurroundingContext } from "@/utils/extractContext";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { genieWarn } from "@/utils/debug";

// ============================================================================
// Content Extraction
// ============================================================================

interface ExtractionResult {
  text: string;
  from: number;
  to: number;
  contextBefore?: string;
  contextAfter?: string;
}

function extractContent(scope: GenieScope, contextRadius = 0): ExtractionResult | null {
  const editor = useTiptapEditorStore.getState().editor;
  const sourceMode = useEditorStore.getState().sourceMode;

  /* v8 ignore start -- callers guard against source mode; defensive only */
  if (sourceMode) {
    const content = useEditorStore.getState().content;
    return { text: content, from: 0, to: content.length };
  }
  /* v8 ignore stop */

  if (!editor) return null;

  const { state } = editor;
  const { doc, selection } = state;

  let result: ExtractionResult | null = null;

  switch (scope) {
    case "selection": {
      if (!selection.empty) {
        // Explicit selection — serialize selected range as markdown
        const range = { from: selection.from, to: selection.to };
        const text = serializeSourcePeekRange(state, range);
        result = { text, from: range.from, to: range.to };
      } else {
        // No selection — expand to compound block (whole list, blockquote, etc.)
        const range = getExpandedSourcePeekRange(state);
        const text = serializeSourcePeekRange(state, range);
        result = { text, from: range.from, to: range.to };
      }
      break;
    }

    case "block": {
      // Expand to compound block — whole list, table, blockquote
      const range = getExpandedSourcePeekRange(state);
      const text = serializeSourcePeekRange(state, range);
      result = { text, from: range.from, to: range.to };
      break;
    }

    case "document": {
      const text = serializeMarkdown(state.schema, doc);
      // Document scope — no context needed (content IS the document)
      return { text, from: 0, to: doc.content.size };
    }

    /* v8 ignore start -- defensive: all valid scopes handled above */
    default:
      return null;
    /* v8 ignore stop */
  }

  // Attach surrounding context for non-document scopes
  if (result && contextRadius > 0) {
    const ctx = extractSurroundingContext(
      state,
      { from: result.from, to: result.to },
      contextRadius
    );
    result.contextBefore = ctx.before;
    result.contextAfter = ctx.after;
  }

  return result;
}

// ============================================================================
// Template Filling
// ============================================================================

function formatContext(before: string, after: string): string {
  const parts: string[] = [];
  if (before) {
    parts.push(`[Before]\n${before}`);
  }
  if (after) {
    parts.push(`[After]\n${after}`);
  }
  return parts.join("\n\n");
}

function fillTemplate(template: string, content: string, context?: string): string {
  let result = template.replace(/\{\{\s*content\s*\}\}/g, content);
  if (context !== undefined) {
    result = result.replace(/\{\{\s*context\s*\}\}/g, context);
  }
  // Safety net: strip any {{context}} missed above (e.g., context undefined)
  result = result.replace(/\{\{\s*context\s*\}\}/g, "");
  return result;
}

// ============================================================================
// Hook
// ============================================================================

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
      };
      invokeGenieRef.current?.(detail.genie, detail.scopeOverride);
    };
    window.addEventListener("mcp:invoke-genie", handler);
    return () => window.removeEventListener("mcp:invoke-genie", handler);
  }, []);

  const runGenie = useCallback(
    async (filledPrompt: string, extraction: ExtractionResult, model?: string, action: GenieAction = "replace", processingLabel?: string) => {
      const providerState = useAiProviderStore.getState();
      const provider = providerState.activeProvider;
      if (!provider) return; // Callers ensure provider exists

      // Validate CLI provider is available before invoking
      if (!REST_TYPES.has(provider)) {
        const cliInfo = providerState.cliProviders.find((p) => p.type === provider);
        if (cliInfo && !cliInfo.available) {
          toast.error(`${cliInfo.name} CLI not found. Install it or choose another provider in Settings.`);
          return;
        }
      }

      // Get REST config if applicable
      const restConfig = providerState.restProviders.find(
        (p) => p.type === provider
      );

      // Validate REST provider has an API key before calling Rust
      if (REST_TYPES.has(provider) && !KEY_OPTIONAL_REST.has(provider)) {
        if (!restConfig?.apiKey) {
          const name = restConfig?.name ?? provider;
          toast.error(`${name} API key is required. Configure it in Settings → Integrations.`);
          return;
        }
      }

      // Generate unique request ID
      const requestId = crypto.randomUUID();

      // Capture current tab ID for suggestion scoping
      const windowLabel = getCurrentWindowLabel();
      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? "unknown";

      // Try to acquire the invocation lock
      if (!useAiInvocationStore.getState().tryStart(requestId)) {
        return; // Already running
      }

      // Signal picker to show processing state (after lock acquired to avoid stale UI)
      /* v8 ignore start -- all callers pass a truthy label; guard is defensive */
      if (processingLabel) {
        useGeniePickerStore.getState().startProcessing(processingLabel);
      }
      /* v8 ignore stop */

      let accumulated = "";

      // Listen for streamed response, filtering by request ID
      const unlisten = await listen<AiResponseChunk>("ai:response", (event) => {
        const chunk = event.payload;
        if (chunk.requestId !== requestId) return;

        if (chunk.error) {
          useGeniePickerStore.getState().setPickerError(chunk.error);
          useAiInvocationStore.getState().setError(chunk.error);
          /* v8 ignore start -- ref cleanup timing depends on async listen resolution */
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
          /* v8 ignore stop */
          return;
        }

        accumulated += chunk.chunk;
        useGeniePickerStore.getState().appendResponse(chunk.chunk);

        if (chunk.done) {
          // Apply accumulated result
          if (accumulated.trim()) {
            const autoApprove = useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
            const isInsert = action === "insert";
            if (autoApprove) {
              // Apply directly — skip ghost text preview
              const editor = useTiptapEditorStore.getState().editor;
              if (editor) {
                const content = accumulated.trim();
                const from = isInsert ? extraction.to : extraction.from;
                const to = extraction.to;
                const slice = createMarkdownPasteSlice(editor.state, content);
                const tr = editor.state.tr
                  .replaceRange(from, to, slice)
                  .scrollIntoView()
                  .setMeta("addToHistory", true);
                editor.view.dispatch(tr);
                useGeniePickerStore.getState().closePicker();
                useAiInvocationStore.getState().finish();
              } else {
                useGeniePickerStore.getState().setPickerError("Editor unavailable — cannot apply changes");
                useAiInvocationStore.getState().setError("Editor unavailable");
              }
            } else {
              // Show preview in picker (don't close)
              useGeniePickerStore.getState().setPreview(accumulated.trim());
              useAiInvocationStore.getState().finish();
              // Also create suggestion for when user accepts
              useAiSuggestionStore.getState().addSuggestion({
                tabId,
                type: isInsert ? "insert" : "replace",
                from: isInsert ? extraction.to : extraction.from,
                to: extraction.to,
                newContent: accumulated.trim(),
                originalContent: isInsert ? "" : extraction.text,
              });
            }
          } else {
            // Empty result
            useGeniePickerStore.getState().setPickerError("AI returned empty response");
            useAiInvocationStore.getState().setError("Empty response");
          }
          /* v8 ignore start -- ref cleanup timing depends on async listen resolution */
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
          /* v8 ignore stop */
        }
      });

      unlistenRef.current = unlisten;

      // Look up resolved CLI path (used on Windows for .cmd/.bat shims)
      const cliInfo = providerState.cliProviders.find((p) => p.type === provider);

      try {
        await invoke("run_ai_prompt", {
          requestId,
          provider,
          prompt: filledPrompt,
          model: model ?? restConfig?.model ?? null,
          apiKey: restConfig?.apiKey ?? null,
          endpoint: restConfig?.endpoint ?? null,
          cliPath: cliInfo?.path ?? null,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        useGeniePickerStore.getState().setPickerError(message);
        useAiInvocationStore.getState().setError(message);
        /* v8 ignore start -- ref cleanup timing depends on async listen resolution */
        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
        /* v8 ignore stop */
      }
    },
    []
  );

  const invokeGenie = useCallback(
    async (genie: GenieDefinition, scopeOverride?: GenieScope) => {
      // Block in Source Mode — suggestions can only apply via Tiptap
      if (useEditorStore.getState().sourceMode) {
        toast.info("Genies are not available in Source Mode");
        return;
      }

      // Auto-detect provider if none selected
      const hasProvider = await useAiProviderStore.getState().ensureProvider();
      if (!hasProvider) {
        toast.error("No AI provider available. Configure one in Settings.");
        return;
      }

      const scope = scopeOverride ?? genie.metadata.scope;
      const contextRadius = genie.metadata.context ?? 0;
      const extracted = extractContent(scope, contextRadius);
      if (!extracted) {
        genieWarn("No content to extract for scope:", scope);
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

      await runGenie(filled, extracted, genie.metadata.model, genie.metadata.action ?? "replace", genie.metadata.name);
    },
    [runGenie]
  );

  // Keep ref in sync for MCP bridge listener
  invokeGenieRef.current = invokeGenie;

  const invokeFreeform = useCallback(
    async (userPrompt: string, scope: GenieScope) => {
      // Block in Source Mode — suggestions can only apply via Tiptap
      if (useEditorStore.getState().sourceMode) {
        toast.info("Genies are not available in Source Mode");
        return;
      }

      // Auto-detect provider if none selected
      const hasProvider = await useAiProviderStore.getState().ensureProvider();
      if (!hasProvider) {
        toast.error("No AI provider available. Configure one in Settings.");
        return;
      }

      // Auto-include ±1 context for selection/block scope
      const contextRadius = scope !== "document" ? 1 : 0;
      const extracted = extractContent(scope, contextRadius);
      if (!extracted) {
        genieWarn("No content to extract for scope:", scope);
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
      await runGenie(filled, extracted, undefined, "replace", userPrompt);
    },
    [runGenie]
  );

  return { invokeGenie, invokeFreeform, isRunning, cancel };
}
