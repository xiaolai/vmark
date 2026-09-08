/**
 * The gates between "the user asked for a genie" and "the provider was asked".
 *
 * Audit #729 — Source Mode is re-checked AFTER `ensureProvider()` awaits.
 * Audit #730 — recency records a DISPATCH, not an intent.
 * Audit #732 — the stream listener is torn down through `safeUnlisten`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { GenieDefinition } from "@/types/aiGenies";

let unlistenResult: (() => unknown) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(unlistenResult ?? (() => undefined)),
}));

const mockInvoke = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const toastInfo = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: vi.fn(), info: (...a: unknown[]) => toastInfo(...a), success: vi.fn() },
}));

const cleanupWarn = vi.fn();
vi.mock("@/utils/debug", () => ({
  genieWarn: vi.fn(),
  cleanupWarn: (...a: unknown[]) => cleanupWarn(...a),
}));

vi.mock("@/services/editor/sourcePeek", () => ({
  getExpandedSourcePeekRange: () => ({ from: 0, to: 5 }),
  serializeSourcePeekRange: () => "hello",
}));
vi.mock("@/services/editor/extractContext", () => ({
  extractSurroundingContext: () => ({ before: "", after: "" }),
}));
vi.mock("@/utils/markdownPipeline", () => ({ serializeMarkdown: () => "hello" }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { useAiInvocationStore, useAiProviderStore, useGeniesStore } from "@/stores/aiStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { useUIStore } from "@/stores/uiStore";
import { useGenieInvocation } from "../useGenieInvocation";

function makeGenie(name = "Test Genie"): GenieDefinition {
  return {
    metadata: { name, scope: "selection", action: "replace" },
    template: "Fix this: {{content}}",
  } as GenieDefinition;
}

/** Enough Tiptap surface for the extraction path. */
function installEditor() {
  const editor = {
    state: {
      doc: { content: { size: 5 } },
      selection: { from: 0, to: 5, empty: false },
      tr: { replaceRange: vi.fn(), scrollIntoView: vi.fn(), setMeta: vi.fn() },
    },
    view: { dispatch: vi.fn() },
  };
  useEditorStore.setState((s) => ({ tiptap: { ...s.tiptap, editor: editor as never } }));
  useEditorStore.getState().setActiveWysiwygEditor(editor as never, "tab-1");
}

/** Seed the REAL provider store — mock-boundaries forbids mocking a store. */
function seedProvider(opts: { apiKey: string; onEnsure?: () => void }) {
  useAiProviderStore.setState({
    activeProvider: "openai",
    restProviders: [
      { type: "openai", name: "OpenAI", apiKey: opts.apiKey, model: "gpt-4", endpoint: "" } as never,
    ],
    cliProviders: [],
    ensureProvider: async () => {
      await Promise.resolve();
      opts.onEnsure?.();
      return true;
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  unlistenResult = null;
  useAiInvocationStore.getState().cancel();
  useGeniesStore.setState({ recentGenieNames: [] });
  useUIStore.setState({ sourceMode: false });
  useTabStore.setState({ activeTabId: { main: "tab-1" } });
  installEditor();
});

describe("recency records a dispatch, not an intent (audit #730)", () => {
  it("records the genie once the request reaches the provider", async () => {
    seedProvider({ apiKey: "sk-test" });
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie("Dispatched"));
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_ai_prompt", expect.anything());
    expect(useGeniesStore.getState().recentGenieNames).toEqual(["Dispatched"]);
  });

  it("does NOT record a genie provider validation refused", async () => {
    // No API key: validateProvider toasts and returns before the lock.
    seedProvider({ apiKey: "" });
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie("Refused"));
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useGeniesStore.getState().recentGenieNames).toEqual([]);
  });

  it("does NOT record a genie the invocation lock refused", async () => {
    seedProvider({ apiKey: "sk-test" });
    expect(useAiInvocationStore.getState().tryStart("someone-else")).toBe(true);
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie("Locked out"));
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useGeniesStore.getState().recentGenieNames).toEqual([]);
  });
});

describe("Source Mode is re-checked after the provider await (audit #729)", () => {
  it("refuses a run the user pushed into Source Mode mid-detection", async () => {
    // Provider detection spawns a process and can take seconds; F6 during that
    // wait used to leave the check answered for a surface no longer mounted.
    seedProvider({
      apiKey: "sk-test",
      onEnsure: () => useUIStore.setState({ sourceMode: true }),
    });
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie("Too late"));
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalled();
    expect(useGeniesStore.getState().recentGenieNames).toEqual([]);
  });
});

describe("cancel tears the listener down safely (audit #732)", () => {
  it("swallows an unlisten that hands back a rejected promise", async () => {
    // Tauri types UnlistenFn as `() => void` while the implementation is async,
    // so a failing unlisten returns a rejection no try/catch here can see.
    unlistenResult = () => Promise.reject(new Error("listener registry gone"));
    seedProvider({ apiKey: "sk-test" });
    const { result } = renderHook(() => useGenieInvocation());

    await act(async () => {
      await result.current.invokeGenie(makeGenie("Cancelled"));
    });
    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(cleanupWarn).toHaveBeenCalled();
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });
});
