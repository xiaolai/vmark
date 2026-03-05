/**
 * Tests for useGenieInvocation — verifying picker store wiring.
 *
 * These tests verify that the invocation hook correctly feeds state
 * into geniePickerStore and aiInvocationStore at each stage of the
 * streaming pipeline.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { GenieDefinition } from "@/types/aiGenies";

// ---------------------------------------------------------------------------
// Mocks — must appear before the module-under-test import
// ---------------------------------------------------------------------------

// Capture the listen callback so tests can simulate streaming chunks
let listenCallback: ((event: { payload: Record<string, unknown> }) => void) | null = null;
const mockUnlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_eventName: string, cb: (event: { payload: Record<string, unknown> }) => void) => {
    listenCallback = cb;
    return Promise.resolve(mockUnlisten);
  }),
}));

const mockInvoke = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn(() => ({ content: [] })),
}));

vi.mock("@/utils/sourcePeek", () => ({
  getExpandedSourcePeekRange: vi.fn(() => ({ from: 0, to: 5 })),
  serializeSourcePeekRange: vi.fn(() => "hello"),
}));

vi.mock("@/utils/extractContext", () => ({
  extractSurroundingContext: vi.fn(() => ({ before: "", after: "" })),
}));

vi.mock("@/utils/markdownPipeline", () => ({
  serializeMarkdown: vi.fn(() => "hello"),
}));

vi.mock("@/utils/debug", () => ({
  genieWarn: vi.fn(),
}));

let mockWindowLabel = "main";
vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => mockWindowLabel,
}));

// ---------------------------------------------------------------------------
// Store imports (after mocks)
// ---------------------------------------------------------------------------

import { toast } from "sonner";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useAiInvocationStore } from "@/stores/aiInvocationStore";
import { useAiProviderStore } from "@/stores/aiProviderStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { useTabStore } from "@/stores/tabStore";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { useGenieInvocation } from "../useGenieInvocation";
import { genieWarn } from "@/utils/debug";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGenie(overrides?: Partial<GenieDefinition>): GenieDefinition {
  return {
    metadata: {
      name: "Test Genie",
      scope: "selection",
      action: "replace",
      ...(overrides?.metadata ?? {}),
    },
    template: "Fix this: {{content}}",
    ...overrides,
  } as GenieDefinition;
}

/** Simulate a fake Tiptap editor with enough API surface for the hook */
function makeFakeEditor() {
  const fakeTr = {
    replaceRange: vi.fn().mockReturnThis(),
    scrollIntoView: vi.fn().mockReturnThis(),
    setMeta: vi.fn().mockReturnThis(),
  };
  return {
    state: {
      doc: { content: { size: 5 } },
      selection: { from: 0, to: 5, empty: false },
      tr: fakeTr,
    },
    view: {
      dispatch: vi.fn(),
    },
  };
}

function resetStores() {
  useGeniePickerStore.setState({
    isOpen: false,
    filterScope: null,
    mode: "search",
    submittedPrompt: null,
    responseText: "",
    pickerError: null,
  });
  useAiInvocationStore.getState().cancel();
  useAiSuggestionStore.setState({ suggestions: new Map(), focusedSuggestionId: null });
  useEditorStore.setState({ sourceMode: false, content: "" });
  useTabStore.setState({ activeTabId: { main: "tab-1" } });
  mockWindowLabel = "main";
}

function setupProviderAndEditor() {
  // Ensure provider check passes
  useAiProviderStore.setState({
    activeProvider: "openai",
    restProviders: [
      { type: "openai", name: "OpenAI", apiKey: "sk-test", model: "gpt-4", endpoint: null } as never,
    ],
    cliProviders: [
      { type: "claude-cli", name: "Claude CLI", available: true, path: "/usr/bin/claude" } as never,
    ],
    ensureProvider: vi.fn(async () => true),
  } as never);

  // Set up a fake editor
  const fakeEditor = makeFakeEditor();
  useTiptapEditorStore.setState({ editor: fakeEditor as never });

  return fakeEditor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useGenieInvocation — picker store wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenCallback = null;
    resetStores();
  });

  // =========================================================================
  // invokeGenie → startProcessing
  // =========================================================================

  it("calls startProcessing on geniePickerStore before streaming", async () => {
    setupProviderAndEditor();
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    const pickerState = useGeniePickerStore.getState();
    expect(pickerState.mode).toBe("processing");
    expect(pickerState.submittedPrompt).toBe("Test Genie");
  });

  // =========================================================================
  // invokeFreeform → startProcessing
  // =========================================================================

  it("calls startProcessing on geniePickerStore for freeform invocation", async () => {
    setupProviderAndEditor();
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeFreeform("make it better", "selection");
    });

    const pickerState = useGeniePickerStore.getState();
    expect(pickerState.mode).toBe("processing");
    expect(pickerState.submittedPrompt).toBe("make it better");
  });

  // =========================================================================
  // Streaming: error chunk → setPickerError + setError
  // =========================================================================

  it("sets picker error and invocation error on streaming error", async () => {
    setupProviderAndEditor();
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    // Simulate error chunk
    act(() => {
      listenCallback?.({
        payload: {
          requestId: useAiInvocationStore.getState().requestId,
          error: "Provider timeout",
          chunk: "",
          done: false,
        },
      });
    });

    expect(useGeniePickerStore.getState().mode).toBe("error");
    expect(useGeniePickerStore.getState().pickerError).toBe("Provider timeout");
    expect(useAiInvocationStore.getState().error).toBe("Provider timeout");
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });

  // =========================================================================
  // Streaming: chunk → appendResponse
  // =========================================================================

  it("appends streaming chunks to picker responseText", async () => {
    setupProviderAndEditor();
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    const requestId = useAiInvocationStore.getState().requestId;

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "Hello ", done: false, error: null },
      });
    });

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "world", done: false, error: null },
      });
    });

    expect(useGeniePickerStore.getState().responseText).toBe("Hello world");
  });

  // =========================================================================
  // Streaming: done + autoApprove → closePicker + finish
  // =========================================================================

  it("closes picker and finishes invocation on done with autoApprove", async () => {
    setupProviderAndEditor();
    useSettingsStore.setState({
      advanced: { mcpServer: { autoApproveEdits: true } } as never,
    });

    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    const requestId = useAiInvocationStore.getState().requestId;

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "fixed content", done: false, error: null },
      });
    });

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "", done: true, error: null },
      });
    });

    // Picker should be closed (reset to initial)
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
    expect(useGeniePickerStore.getState().mode).toBe("search");

    // Invocation should show success (finish was called)
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().showSuccess).toBe(true);
  });

  // =========================================================================
  // Streaming: done + no autoApprove → setPreview + finish + addSuggestion
  // =========================================================================

  it("shows preview and creates suggestion on done without autoApprove", async () => {
    setupProviderAndEditor();
    useSettingsStore.setState({
      advanced: { mcpServer: { autoApproveEdits: false } } as never,
    });

    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    const requestId = useAiInvocationStore.getState().requestId;

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "improved text", done: false, error: null },
      });
    });

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "", done: true, error: null },
      });
    });

    // Picker should be in preview mode with the response
    expect(useGeniePickerStore.getState().mode).toBe("preview");
    expect(useGeniePickerStore.getState().responseText).toBe("improved text");

    // Invocation should show success
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().showSuccess).toBe(true);

    // Suggestion should be created
    const suggestions = useAiSuggestionStore.getState().suggestions;
    expect(suggestions.size).toBe(1);
    const [, suggestion] = [...suggestions.entries()][0];
    expect(suggestion.tabId).toBe("tab-1");
    expect(suggestion.newContent).toBe("improved text");
  });

  // =========================================================================
  // Streaming: done + empty response → setPickerError + setError
  // =========================================================================

  it("sets error on empty AI response", async () => {
    setupProviderAndEditor();
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    const requestId = useAiInvocationStore.getState().requestId;

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "", done: true, error: null },
      });
    });

    expect(useGeniePickerStore.getState().mode).toBe("error");
    expect(useGeniePickerStore.getState().pickerError).toBe("AI returned empty response");
    expect(useAiInvocationStore.getState().error).toBe("Empty response");
  });

  // =========================================================================
  // invoke() rejection → setPickerError + setError
  // =========================================================================

  it("sets picker and invocation error when invoke rejects", async () => {
    setupProviderAndEditor();
    mockInvoke.mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(useGeniePickerStore.getState().mode).toBe("error");
    expect(useGeniePickerStore.getState().pickerError).toBe("Network failure");
    expect(useAiInvocationStore.getState().error).toBe("Network failure");
  });

  // =========================================================================
  // invoke() rejection with non-Error → string coercion
  // =========================================================================

  it("handles non-Error rejection with String coercion", async () => {
    setupProviderAndEditor();
    mockInvoke.mockRejectedValueOnce("raw string error");

    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(useGeniePickerStore.getState().pickerError).toBe("raw string error");
    expect(useAiInvocationStore.getState().error).toBe("raw string error");
  });

  // =========================================================================
  // Validation: source mode blocks invocation
  // =========================================================================

  it("blocks invokeGenie in source mode with toast", async () => {
    setupProviderAndEditor();
    useEditorStore.setState({ sourceMode: true });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(toast.info).toHaveBeenCalledWith("Genies are not available in Source Mode");
    // Should NOT have started processing
    expect(useGeniePickerStore.getState().mode).toBe("search");
  });

  it("blocks invokeFreeform in source mode with toast", async () => {
    setupProviderAndEditor();
    useEditorStore.setState({ sourceMode: true });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeFreeform("do something", "selection");
    });

    expect(toast.info).toHaveBeenCalledWith("Genies are not available in Source Mode");
  });

  // =========================================================================
  // Validation: no provider
  // =========================================================================

  it("shows error when no AI provider is available", async () => {
    setupProviderAndEditor();
    // Mock ensureProvider to return false
    useAiProviderStore.setState({
      activeProvider: null,
      ensureProvider: vi.fn(async () => false),
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(toast.error).toHaveBeenCalledWith("No AI provider available. Configure one in Settings.");
  });

  it("shows error when no provider for freeform", async () => {
    setupProviderAndEditor();
    useAiProviderStore.setState({
      activeProvider: null,
      ensureProvider: vi.fn(async () => false),
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeFreeform("test", "selection");
    });

    expect(toast.error).toHaveBeenCalledWith("No AI provider available. Configure one in Settings.");
  });

  // =========================================================================
  // Validation: no editor (null extraction)
  // =========================================================================

  it("warns when no content can be extracted", async () => {
    setupProviderAndEditor();
    useTiptapEditorStore.setState({ editor: null as never });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(genieWarn).toHaveBeenCalledWith("No content to extract for scope:", "selection");
  });

  // =========================================================================
  // Validation: CLI provider not available
  // =========================================================================

  it("shows error for unavailable CLI provider", async () => {
    const fakeEditor = makeFakeEditor();
    useTiptapEditorStore.setState({ editor: fakeEditor as never });
    useAiProviderStore.setState({
      activeProvider: "claude-cli",
      restProviders: [],
      cliProviders: [
        { type: "claude-cli", name: "Claude CLI", available: false, path: null } as never,
      ],
      ensureProvider: vi.fn(async () => true),
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("CLI not found")
    );
  });

  // =========================================================================
  // CLI provider: invoke with null rest config fields
  // =========================================================================

  it("invokes with null model/apiKey/endpoint for CLI provider", async () => {
    const fakeEditor = makeFakeEditor();
    useTiptapEditorStore.setState({ editor: fakeEditor as never });
    useAiProviderStore.setState({
      activeProvider: "claude-cli",
      restProviders: [],
      cliProviders: [
        { type: "claude-cli", name: "Claude CLI", available: true, path: "/usr/bin/claude" } as never,
      ],
      ensureProvider: vi.fn(async () => true),
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "run_ai_prompt",
      expect.objectContaining({
        model: null,
        apiKey: null,
        endpoint: null,
        cliPath: "/usr/bin/claude",
      })
    );
  });

  // =========================================================================
  // Fallback: tabId defaults to "unknown" when window has no active tab
  // =========================================================================

  it("uses 'unknown' tabId when window has no active tab", async () => {
    setupProviderAndEditor();
    useSettingsStore.setState({
      advanced: { mcpServer: { autoApproveEdits: false } } as never,
    });

    // Remove active tab for the window
    useTabStore.setState({ activeTabId: {} });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    const requestId = useAiInvocationStore.getState().requestId;
    act(() => {
      listenCallback?.({ payload: { requestId, chunk: "text", done: false, error: null } });
    });
    act(() => {
      listenCallback?.({ payload: { requestId, chunk: "", done: true, error: null } });
    });

    const suggestions = useAiSuggestionStore.getState().suggestions;
    expect(suggestions.size).toBe(1);
    const [, suggestion] = [...suggestions.entries()][0];
    expect(suggestion.tabId).toBe("unknown");
  });

  // =========================================================================
  // Validation: REST provider missing API key
  // =========================================================================

  it("shows error for REST provider without API key", async () => {
    const fakeEditor = makeFakeEditor();
    useTiptapEditorStore.setState({ editor: fakeEditor as never });
    useAiProviderStore.setState({
      activeProvider: "openai",
      restProviders: [
        { type: "openai", name: "OpenAI", apiKey: "", model: "gpt-4", endpoint: null } as never,
      ],
      cliProviders: [],
      ensureProvider: vi.fn(async () => true),
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("API key is required")
    );
  });

  it("falls back to provider type when REST config has no name", async () => {
    const fakeEditor = makeFakeEditor();
    useTiptapEditorStore.setState({ editor: fakeEditor as never });
    useAiProviderStore.setState({
      activeProvider: "openai",
      restProviders: [
        { type: "openai", apiKey: "", model: "gpt-4", endpoint: null } as never,
      ],
      cliProviders: [],
      ensureProvider: vi.fn(async () => true),
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("openai API key is required")
    );
  });

  // =========================================================================
  // Validation: already running (tryStart returns false)
  // =========================================================================

  it("does nothing when already running", async () => {
    setupProviderAndEditor();
    // Pre-acquire the lock
    useAiInvocationStore.getState().tryStart("existing-request");

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    // Should not have called startProcessing a second time for the new genie
    // (first call was from the test itself, not from the hook)
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Validation: picker mode does NOT change when tryStart fails
  // =========================================================================

  it("does not set processing mode when tryStart returns false (already running)", async () => {
    setupProviderAndEditor();
    // Pre-acquire the lock so tryStart will return false
    useAiInvocationStore.getState().tryStart("existing-request");

    // Set picker to search mode initially
    useGeniePickerStore.setState({ mode: "search" });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    // Picker should NOT be stuck in processing — it should remain in search mode
    expect(useGeniePickerStore.getState().mode).toBe("search");
    expect(useGeniePickerStore.getState().submittedPrompt).toBeNull();
  });

  // =========================================================================
  // Multi-window: tabId derived from window label
  // =========================================================================

  it("creates suggestion with correct tabId for non-main window", async () => {
    setupProviderAndEditor();
    useSettingsStore.setState({
      advanced: { mcpServer: { autoApproveEdits: false } } as never,
    });

    // Simulate window-2 with its own active tab
    mockWindowLabel = "window-2";
    useTabStore.setState({ activeTabId: { main: "tab-1", "window-2": "tab-xyz" } });

    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    const requestId = useAiInvocationStore.getState().requestId;

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "multi-window result", done: false, error: null },
      });
    });

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "", done: true, error: null },
      });
    });

    // Suggestion should be created with the tab ID for window-2
    const suggestions = useAiSuggestionStore.getState().suggestions;
    expect(suggestions.size).toBe(1);
    const [, suggestion] = [...suggestions.entries()][0];
    expect(suggestion.tabId).toBe("tab-xyz");
  });

  // =========================================================================
  // Template: context variable filling
  // =========================================================================

  it("fills context variable in genie template", async () => {
    setupProviderAndEditor();
    const { extractSurroundingContext } = await import("@/utils/extractContext");
    vi.mocked(extractSurroundingContext).mockReturnValue({
      before: "before text",
      after: "after text",
    } as never);

    const genie = makeGenie({
      template: "Fix: {{content}}\nContext: {{context}}",
      metadata: { name: "Context Genie", scope: "selection", action: "replace", context: 1 } as never,
    });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(genie);
    });

    // The prompt should have been passed to invoke with filled template
    expect(mockInvoke).toHaveBeenCalledWith(
      "run_ai_prompt",
      expect.objectContaining({
        prompt: expect.stringContaining("before text"),
      })
    );
  });

  // =========================================================================
  // Freeform: document scope (no context)
  // =========================================================================

  it("invokes genie with block scope", async () => {
    setupProviderAndEditor();
    const genie = makeGenie({ metadata: { name: "Block Genie", scope: "block", action: "replace" } as never });
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(genie);
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "run_ai_prompt",
      expect.objectContaining({
        prompt: expect.stringContaining("hello"),
      })
    );
  });

  it("invokes freeform with document scope (no context)", async () => {
    setupProviderAndEditor();

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeFreeform("summarize", "document");
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "run_ai_prompt",
      expect.objectContaining({
        prompt: expect.stringContaining("summarize"),
      })
    );
  });

  // =========================================================================
  // Freeform: selection scope (with surrounding context)
  // =========================================================================

  it("invokes freeform with selection scope and includes surrounding context", async () => {
    setupProviderAndEditor();
    const { extractSurroundingContext } = await import("@/utils/extractContext");
    vi.mocked(extractSurroundingContext).mockReturnValue({
      before: "paragraph above",
      after: "paragraph below",
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeFreeform("improve this", "selection");
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "run_ai_prompt",
      expect.objectContaining({
        prompt: expect.stringContaining("Context (do not modify)"),
      })
    );
    expect(mockInvoke).toHaveBeenCalledWith(
      "run_ai_prompt",
      expect.objectContaining({
        prompt: expect.stringContaining("paragraph above"),
      })
    );
  });

  // =========================================================================
  // Freeform: selection scope with only before context (no after)
  // =========================================================================

  it("invokes freeform with only before context", async () => {
    setupProviderAndEditor();
    const { extractSurroundingContext } = await import("@/utils/extractContext");
    vi.mocked(extractSurroundingContext).mockReturnValue({
      before: "only before",
      after: "",
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeFreeform("fix it", "selection");
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "run_ai_prompt",
      expect.objectContaining({
        prompt: expect.stringContaining("[Before]"),
      })
    );
    // Should NOT contain [After] section
    const prompt = mockInvoke.mock.calls[0][1] as { prompt: string };
    expect(prompt.prompt).not.toContain("[After]");
  });

  // =========================================================================
  // Freeform: selection scope with only after context (no before)
  // =========================================================================

  it("invokes freeform with only after context", async () => {
    setupProviderAndEditor();
    const { extractSurroundingContext } = await import("@/utils/extractContext");
    vi.mocked(extractSurroundingContext).mockReturnValue({
      before: "",
      after: "only after",
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeFreeform("fix it", "selection");
    });

    const prompt = (mockInvoke.mock.calls[0][1] as { prompt: string }).prompt;
    expect(prompt).toContain("[After]");
    expect(prompt).not.toContain("[Before]");
  });

  // =========================================================================
  // Streaming: ignore chunks from different request ID
  // =========================================================================

  it("ignores streaming chunks from different request IDs", async () => {
    setupProviderAndEditor();
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    act(() => {
      listenCallback?.({
        payload: { requestId: "wrong-id", chunk: "should be ignored", done: false, error: null },
      });
    });

    expect(useGeniePickerStore.getState().responseText).toBe("");
  });

  // =========================================================================
  // Insert action: uses extraction.to as from position
  // =========================================================================

  it("creates insert suggestion with correct position for insert action", async () => {
    setupProviderAndEditor();
    useSettingsStore.setState({
      advanced: { mcpServer: { autoApproveEdits: false } } as never,
    });

    const genie = makeGenie({ metadata: { name: "Insert", scope: "selection", action: "insert" } as never });
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(genie);
    });

    const requestId = useAiInvocationStore.getState().requestId;
    act(() => {
      listenCallback?.({ payload: { requestId, chunk: "inserted text", done: false, error: null } });
    });
    act(() => {
      listenCallback?.({ payload: { requestId, chunk: "", done: true, error: null } });
    });

    const suggestions = useAiSuggestionStore.getState().suggestions;
    expect(suggestions.size).toBe(1);
    const [, suggestion] = [...suggestions.entries()][0];
    expect(suggestion.type).toBe("insert");
    expect(suggestion.originalContent).toBe("");
  });

  // =========================================================================
  // Insert action with autoApprove: uses extraction.to as from position
  // =========================================================================

  it("auto-applies insert action at extraction.to position", async () => {
    const fakeEditor = setupProviderAndEditor();
    useSettingsStore.setState({
      advanced: { mcpServer: { autoApproveEdits: true } } as never,
    });

    const genie = makeGenie({ metadata: { name: "Insert Genie", scope: "selection", action: "insert" } as never });
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(genie);
    });

    const requestId = useAiInvocationStore.getState().requestId;
    act(() => {
      listenCallback?.({ payload: { requestId, chunk: "new text", done: false, error: null } });
    });
    act(() => {
      listenCallback?.({ payload: { requestId, chunk: "", done: true, error: null } });
    });

    // Auto-approve with insert: from should be extraction.to (5), not extraction.from (0)
    expect(fakeEditor.state.tr.replaceRange).toHaveBeenCalledWith(5, 5, expect.anything());
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
  });

  // =========================================================================
  // Action defaults to "replace" when undefined
  // =========================================================================

  it("defaults to replace action when genie has no action metadata", async () => {
    setupProviderAndEditor();
    useSettingsStore.setState({
      advanced: { mcpServer: { autoApproveEdits: false } } as never,
    });

    // Create genie without action field
    const genie = {
      metadata: { name: "No Action Genie", scope: "selection" as const },
      template: "Fix: {{content}}",
    } as GenieDefinition;

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(genie);
    });

    const requestId = useAiInvocationStore.getState().requestId;
    act(() => {
      listenCallback?.({ payload: { requestId, chunk: "result", done: false, error: null } });
    });
    act(() => {
      listenCallback?.({ payload: { requestId, chunk: "", done: true, error: null } });
    });

    const suggestions = useAiSuggestionStore.getState().suggestions;
    expect(suggestions.size).toBe(1);
    const [, suggestion] = [...suggestions.entries()][0];
    expect(suggestion.type).toBe("replace");
  });

  // =========================================================================
  // Cancel cleans up listener on unmount
  // =========================================================================

  it("cancels on unmount", async () => {
    setupProviderAndEditor();
    const { result, unmount } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    unmount();

    // After unmount, the invocation store should be reset
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });

  // =========================================================================
  // Block scope extraction
  // =========================================================================

  it("extracts content for block scope", async () => {
    setupProviderAndEditor();
    const genie = makeGenie({ metadata: { name: "Block", scope: "block", action: "replace" } as never });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(genie);
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_ai_prompt", expect.any(Object));
  });

  // =========================================================================
  // Document scope extraction
  // =========================================================================

  it("extracts content for document scope", async () => {
    setupProviderAndEditor();
    const genie = makeGenie({ metadata: { name: "Doc", scope: "document", action: "replace" } as never });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(genie);
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_ai_prompt", expect.any(Object));
  });

  // =========================================================================
  // Selection scope with empty selection (expands to block)
  // =========================================================================

  it("extracts expanded block when selection is empty", async () => {
    const fakeEditor = makeFakeEditor();
    // Override to have empty selection
    fakeEditor.state.selection = { from: 2, to: 2, empty: true } as never;
    useTiptapEditorStore.setState({ editor: fakeEditor as never });
    useAiProviderStore.setState({
      activeProvider: "openai",
      restProviders: [
        { type: "openai", name: "OpenAI", apiKey: "sk-test", model: "gpt-4", endpoint: null } as never,
      ],
      cliProviders: [],
    });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_ai_prompt", expect.any(Object));
  });

  // =========================================================================
  // Source mode extraction (via invokeFreeform path not blocked)
  // =========================================================================

  // Note: Source mode is blocked at the invokeGenie/invokeFreeform level,
  // so extractContent's source mode branch can't be reached through the
  // public API. This is intentional — the guard prevents it.

  // =========================================================================
  // No active provider (provider null) in runGenie
  // =========================================================================

  it("returns early from runGenie when no active provider", async () => {
    setupProviderAndEditor();
    // Set active provider to null AFTER ensureProvider succeeds
    // This tests the guard inside runGenie
    useAiProviderStore.setState({
      activeProvider: null,
      restProviders: [],
      cliProviders: [],
    });
    // Override ensureProvider to return true but leave activeProvider null
    useAiProviderStore.setState({
      ensureProvider: vi.fn(async () => {
        // Don't set a provider — leave it null
        return true;
      }),
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    // Should not have called invoke since provider is null
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Freeform with context (selection scope includes context)
  // =========================================================================

  it("includes context in freeform prompt for selection scope", async () => {
    setupProviderAndEditor();
    const { extractSurroundingContext } = await import("@/utils/extractContext");
    vi.mocked(extractSurroundingContext).mockReturnValue({
      before: "prefix",
      after: "suffix",
    } as never);

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeFreeform("improve this", "selection");
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "run_ai_prompt",
      expect.objectContaining({
        prompt: expect.stringContaining("Context (do not modify)"),
      })
    );
  });

  // =========================================================================
  // MCP bridge custom event triggers invokeGenie
  // =========================================================================

  it("responds to mcp:invoke-genie custom event", async () => {
    setupProviderAndEditor();
    renderHook(() => useGenieInvocation());

    // Wait for effect to register
    await act(async () => {});

    // Dispatch the MCP bridge event
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mcp:invoke-genie", {
          detail: {
            id: "req-1",
            genie: makeGenie(),
            scopeOverride: undefined,
          },
        })
      );
    });

    // Should have started processing through invokeGenie
    expect(useGeniePickerStore.getState().mode).toBe("processing");
  });

  // =========================================================================
  // Freeform: warns when no content extracted
  // =========================================================================

  it("warns when freeform extraction fails", async () => {
    setupProviderAndEditor();
    useTiptapEditorStore.setState({ editor: null as never });

    const { result } = renderHook(() => useGenieInvocation());
    await act(async () => {
      await result.current.invokeFreeform("do something", "selection");
    });

    expect(genieWarn).toHaveBeenCalledWith("No content to extract for scope:", "selection");
  });

  // =========================================================================
  // Streaming: done + autoApprove + editor null → error
  // =========================================================================

  it("sets error when editor is null during auto-approve apply", async () => {
    setupProviderAndEditor();
    useSettingsStore.setState({
      advanced: { mcpServer: { autoApproveEdits: true } } as never,
    });

    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie());
    });

    const requestId = useAiInvocationStore.getState().requestId;

    // Remove editor after streaming has started (simulates race condition)
    useTiptapEditorStore.setState({ editor: null as never });

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "result text", done: false, error: null },
      });
    });

    act(() => {
      listenCallback?.({
        payload: { requestId, chunk: "", done: true, error: null },
      });
    });

    expect(useGeniePickerStore.getState().pickerError).toBe("Editor unavailable — cannot apply changes");
    expect(useAiInvocationStore.getState().error).toBe("Editor unavailable");
  });
});
