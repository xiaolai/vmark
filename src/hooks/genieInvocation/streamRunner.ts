/**
 * Genie Stream Runner
 *
 * Purpose: Drives one AI genie invocation against the Rust backend —
 *   provider validation, invocation-lock acquisition, `ai:response` stream
 *   listening, and result application (direct auto-apply or suggestion).
 *   Extracted from useGenieInvocation.ts (module split).
 *
 * Key decisions:
 *   - Listener registration lives INSIDE the same try/catch as the invoke:
 *     if listen() rejects, the invocation must not be left stuck in
 *     processing state with the singleton lock held.
 *   - Stale-target guard (WI-0.9, C4): a tab switch mid-stream downgrades
 *     auto-apply to a suggestion scoped to the ORIGINATING tab.
 *   - Suggestion payloads for both paths come from one builder
 *     (buildSuggestionParams) so they cannot drift.
 *
 * @coordinates-with hooks/useGenieInvocation.ts — sole consumer
 * @coordinates-with stores/aiStore — invocation lock, provider config, suggestions
 * @module hooks/genieInvocation/streamRunner
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import type { GenieAction, AiResponseChunk } from "@/types/aiGenies";
import { useAiSuggestionStore, useAiProviderStore, useAiInvocationStore, REST_TYPES, KEY_OPTIONAL_REST } from "@/stores/aiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useEditorStore } from "@/stores/editorStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import { errorMessage } from "@/utils/errorMessage";
import type { ExtractionResult } from "./extraction";

/** Mutable holder for the active stream unlisten fn (owned by the hook). */
interface ListenerRef {
  current: UnlistenFn | null;
}

/** Tear down the stream listener if one is registered. */
function releaseListener(ref: ListenerRef): void {
  /* v8 ignore start -- ref cleanup timing depends on async listen resolution */
  if (ref.current) {
    ref.current();
    ref.current = null;
  }
  /* v8 ignore stop */
}

/** Surface an invocation failure in both the picker and the status stores. */
function failInvocation(message: string): void {
  useGeniePickerStore.getState().setPickerError(message);
  useAiInvocationStore.getState().setError(message);
}

type ProviderState = ReturnType<typeof useAiProviderStore.getState>;

interface ValidatedProvider {
  provider: NonNullable<ProviderState["activeProvider"]>;
  restConfig: ProviderState["restProviders"][number] | undefined;
  cliInfo: ProviderState["cliProviders"][number] | undefined;
}

/** Validate the active provider is usable; toasts and returns null when not. */
function validateProvider(providerState: ProviderState): ValidatedProvider | null {
  const provider = providerState.activeProvider;
  if (!provider) return null; // Callers ensure provider exists

  const cliInfo = providerState.cliProviders.find((p) => p.type === provider);

  // Validate CLI provider is available before invoking
  if (!REST_TYPES.has(provider) && cliInfo && !cliInfo.available) {
    toast.error(i18n.t("dialog:toast.genieCliNotFound", { name: cliInfo.name }));
    return null;
  }

  const restConfig = providerState.restProviders.find((p) => p.type === provider);

  // Validate REST provider has an API key before calling Rust
  if (REST_TYPES.has(provider) && !KEY_OPTIONAL_REST.has(provider) && !restConfig?.apiKey) {
    const name = restConfig?.name ?? provider;
    toast.error(i18n.t("dialog:toast.genieApiKeyRequired", { name }));
    return null;
  }

  return { provider, restConfig, cliInfo };
}

/**
 * Suggestion payload shared by BOTH suggestion paths (auto-approve with a
 * mid-stream tab switch, and the normal preview flow) — single builder so
 * the two cannot drift.
 */
function buildSuggestionParams(
  tabId: string,
  action: GenieAction,
  extraction: ExtractionResult,
  content: string,
): Parameters<ReturnType<typeof useAiSuggestionStore.getState>["addSuggestion"]>[0] {
  const isInsert = action === "insert";
  return {
    tabId,
    type: isInsert ? "insert" : "replace",
    from: isInsert ? extraction.to : extraction.from,
    to: extraction.to,
    wholeDoc: !isInsert && (extraction.wholeDoc ?? false),
    newContent: content,
    originalContent: isInsert ? "" : extraction.text,
  };
}

interface RunContext {
  requestId: string;
  tabId: string;
  windowLabel: string;
  extraction: ExtractionResult;
  action: GenieAction;
  listenerRef: ListenerRef;
}

/** Auto-approve path: apply the result straight into the live editor. */
function applyDirectly(ctx: RunContext, content: string): void {
  const editor = useEditorStore.getState().tiptap.editor;
  if (!editor) {
    failInvocation(i18n.t("dialog:toast.genieEditorUnavailable"));
    return;
  }
  const isInsert = ctx.action === "insert";
  const from = isInsert ? ctx.extraction.to : ctx.extraction.from;
  const to = ctx.extraction.to;
  const slice = createMarkdownPasteSlice(editor.state, content);
  const tr = editor.state.tr
    .replaceRange(from, to, slice)
    .scrollIntoView()
    .setMeta("addToHistory", true);
  editor.view.dispatch(tr);
  useGeniePickerStore.getState().closePicker();
  useAiInvocationStore.getState().finish();
}

/** Terminal done-frame: apply, suggest, or error depending on state. */
function handleStreamDone(ctx: RunContext, accumulated: string): void {
  const content = accumulated.trim();
  if (!content) {
    failInvocation(i18n.t("dialog:toast.genieEmptyResponse"));
    return;
  }

  const autoApprove = useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
  // Stale-target guard (WI-0.9, C4): if the user navigated to a different
  // tab while the stream was arriving, the captured from/to positions belong
  // to the originating doc. Applying them to the now-active editor would
  // corrupt the wrong document. Preserve the result as a suggestion scoped
  // to the originating tab instead.
  const currentTabId = useTabStore.getState().activeTabId[ctx.windowLabel] ?? "unknown";
  const tabSwitched = currentTabId !== ctx.tabId;

  if (autoApprove && tabSwitched) {
    useAiSuggestionStore
      .getState()
      .addSuggestion(buildSuggestionParams(ctx.tabId, ctx.action, ctx.extraction, content));
    useGeniePickerStore.getState().closePicker();
    useAiInvocationStore.getState().finish();
  } else if (autoApprove) {
    // Apply directly — skip ghost text preview
    applyDirectly(ctx, content);
  } else {
    // Show preview in picker (don't close)
    useGeniePickerStore.getState().setPreview(content);
    useAiInvocationStore.getState().finish();
    // Also create suggestion for when user accepts
    useAiSuggestionStore
      .getState()
      .addSuggestion(buildSuggestionParams(ctx.tabId, ctx.action, ctx.extraction, content));
  }
}

/** Build the `ai:response` handler; accumulates chunks for this request only. */
function createChunkHandler(ctx: RunContext): (event: { payload: AiResponseChunk }) => void {
  let accumulated = "";
  return (event) => {
    const chunk = event.payload;
    if (chunk.requestId !== ctx.requestId) return;

    if (chunk.error) {
      failInvocation(chunk.error);
      releaseListener(ctx.listenerRef);
      return;
    }

    // Defend the AI-response boundary (WI-4.1, T2): a chunk that omits the
    // text field (e.g. a terminal done-frame) must not append the literal
    // string "undefined" to the accumulated result.
    const text = typeof chunk.chunk === "string" ? chunk.chunk : "";
    accumulated += text;
    useGeniePickerStore.getState().appendResponse(text);

    if (chunk.done) {
      handleStreamDone(ctx, accumulated);
      releaseListener(ctx.listenerRef);
    }
  };
}

export interface RunGenieStreamOptions {
  filledPrompt: string;
  extraction: ExtractionResult;
  model?: string;
  action?: GenieAction;
  processingLabel?: string;
  /** Owned by the calling hook so cancel/unmount can tear the listener down. */
  listenerRef: ListenerRef;
}

/**
 * Run one genie prompt against the active provider, streaming the response
 * into the picker and applying the terminal result. Resolves once the invoke
 * returns (the stream listener outlives it until the done-frame arrives).
 */
export async function runGenieStream(options: RunGenieStreamOptions): Promise<void> {
  const { filledPrompt, extraction, model, action = "replace", processingLabel, listenerRef } = options;

  const validated = validateProvider(useAiProviderStore.getState());
  if (!validated) return;
  const { provider, restConfig, cliInfo } = validated;

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

  const ctx: RunContext = { requestId, tabId, windowLabel, extraction, action, listenerRef };

  try {
    // Listener registration sits INSIDE the try: if listen() rejects, the
    // invocation must fail loudly (error state + lock release) instead of
    // sticking in processing/running forever.
    listenerRef.current = await listen<AiResponseChunk>("ai:response", createChunkHandler(ctx));

    // cliPath: resolved CLI path (used on Windows for .cmd/.bat shims)
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
    failInvocation(errorMessage(e));
    releaseListener(listenerRef);
  }
}
