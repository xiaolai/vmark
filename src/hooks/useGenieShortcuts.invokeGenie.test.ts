// WI-RA14C.4 — menu:invoke-genie, observed at the Rust boundary through the
// REAL invocation pipeline (useGenieInvocation, the AI/workflow/tab/editor
// stores, extraction and the stream runner). Only Tauri (`invoke`/`listen`)
// and sonner are mocked; nothing inside the app is.
//
// The native Genies menu lists BOTH markdown prompts (.md) and YAML workflows
// (.yml/.yaml); `read_genie` returns raw YAML as `template` for the latter.
// The handler must derive the `kind` discriminator from the file extension
// (the same source the Rust scanner classifies by), or a workflow genie
// invoked from the menu takes the PROMPT path — sending raw workflow YAML to
// the AI as a whole-document replacement. So the assertions here name the
// Rust command each genie reaches and what it carries, not that a stand-in
// was called.
//
// Pure-helper coverage (getMenuShortcuts, detectScope) lives in
// useGenieShortcuts.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useAiInvocationStore, useAiProviderStore, useGeniesStore } from "@/stores/aiStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkflowStore } from "@/stores/workflowStore";
import { setCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { resetWorkflowEvents, retainWorkflowEvents } from "@/services/workflow/workflowRunEvents";
import { WindowContext } from "@/contexts/WindowContext";
import { useGenieMenuInvocation, useGenieShortcuts } from "./useGenieShortcuts";

type EventHandler = (event: { payload: unknown }) => void | Promise<void>;

const bridge = vi.hoisted(() => ({ handlers: new Map<string, EventHandler>() }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: EventHandler) => {
    bridge.handlers.set(event, handler);
    return Promise.resolve(() => {});
  }),
}));

// sonner is the external boundary; the IME-safe toast wrapper runs real.
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const mockInvoke = vi.mocked(invoke);

const TAB = "tab-genie";
const WORKSPACE = "/repo";
const WORKFLOW_YAML = "steps:\n  - id: s1";

const WORKFLOW_METADATA = { name: "review", description: "Review workflow", scope: "document" as const };
const MARKDOWN_METADATA = { name: "improve", description: "Improve prose", scope: "selection" as const };

/** What `read_genie` answers for the next invocation. */
let readGenie: () => Promise<unknown>;
let editors: Editor[] = [];

function mountEditor(): Editor {
  const editor = new Editor({ extensions: [StarterKit], content: "<p>hello world</p>" });
  editors.push(editor);
  useEditorStore.getState().setTiptapEditor(editor);
  useEditorStore.getState().setActiveWysiwygEditor(editor, TAB);
  // Select "hello" (positions 1–6) — the selection-scoped genie's input.
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
  return editor;
}

/** Arguments of every call to one Rust command, in order. */
function callsOf(command: string): Array<Record<string, unknown>> {
  return mockInvoke.mock.calls
    .filter(([cmd]) => cmd === command)
    .map(([, args]) => (args ?? {}) as Record<string, unknown>);
}

/** Render inside the document window `label`, as App.tsx's WindowProvider does. */
function inWindow(label: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(WindowContext.Provider, { value: { windowLabel: label, isDocumentWindow: true } }, children);
}

/** The registered menu:invoke-genie listener (the latest mount's). */
function invokeGenieHandler(): EventHandler {
  const handler = bridge.handlers.get("menu:invoke-genie");
  if (!handler) throw new Error("menu:invoke-genie listener was never registered");
  return handler;
}

/** Mount the hook in "main" and fire a menu click aimed at "main" — Rust's `[path, focusedLabel]`. */
async function invokeFromMenu(path: string): Promise<void> {
  renderHook(() => useGenieMenuInvocation(), { wrapper: inWindow("main") });
  const handler = invokeGenieHandler();
  await act(async () => {
    await handler({ payload: [path, "main"] });
  });
  // The invocation is fire-and-forget from the handler; let it reach Rust.
  await vi.waitFor(() => {
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "read_genie")).toBe(true);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.handlers.clear();
  readGenie = () => Promise.resolve({ metadata: WORKFLOW_METADATA, template: WORKFLOW_YAML });
  mockInvoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === "read_genie") return readGenie();
    if (cmd === "load_genies") return Promise.resolve([]);
    if (cmd === "run_workflow") return Promise.resolve("exec-from-rust");
    return Promise.resolve(undefined);
  });
  resetWorkflowEvents();
  retainWorkflowEvents(); // the workflow panel's hold, which the app always mounts
  useWorkflowStore.getState().setExecution(null);
  useAiInvocationStore.getState().cancel();
  useGeniesStore.setState({ recentGenieNames: [] });
  useUIStore.setState({ sourceMode: false });
  useWorkspaceStore.setState({ rootPath: WORKSPACE });
  useAiProviderStore.setState({
    activeProvider: "openai",
    cliProviders: [],
    restProviders: [
      { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1", apiKey: "sk-test", model: "gpt-4" },
    ],
  });
  setCurrentWindowLabel("main");
  useTabStore.setState({ activeTabId: { main: TAB } });
  useEditorStore.getState().clearTiptap();
});

afterEach(() => {
  cleanup();
  for (const editor of editors) editor.destroy();
  editors = [];
  resetWorkflowEvents();
});

describe("menu:invoke-genie — a workflow genie runs as a workflow", () => {
  it("a .yml genie reaches run_workflow with its YAML and the workspace root, never run_ai_prompt", async () => {
    await invokeFromMenu("/genies/review.yml");

    await vi.waitFor(() => expect(callsOf("run_workflow")).toHaveLength(1));
    const [run] = callsOf("run_workflow");
    expect(run.yaml).toBe(WORKFLOW_YAML);
    expect(run.workspaceRoot).toBe(WORKSPACE);
    expect(callsOf("run_ai_prompt")).toHaveLength(0);
    // The run was registered under the id Rust was given, and recorded as run.
    expect(useWorkflowStore.getState().preview.executionId).toBe(run.executionId);
    expect(useGeniesStore.getState().recentGenieNames).toEqual(["review"]);
  });

  it("the extension match is case-insensitive (.YAML)", async () => {
    await invokeFromMenu("/genies/review.YAML");

    await vi.waitFor(() => expect(callsOf("run_workflow")).toHaveLength(1));
    expect(callsOf("run_workflow")[0].yaml).toBe(WORKFLOW_YAML);
    expect(callsOf("run_ai_prompt")).toHaveLength(0);
  });

  it("a .md genie whose name contains .yml is still a prompt genie (the match is anchored)", async () => {
    mountEditor();
    readGenie = () => Promise.resolve({ metadata: MARKDOWN_METADATA, template: "Improve: {{content}}" });

    await invokeFromMenu("/genies/notes.yml.md");

    await vi.waitFor(() => expect(callsOf("run_ai_prompt")).toHaveLength(1));
    expect(callsOf("run_workflow")).toHaveLength(0);
  });
});

describe("menu:invoke-genie — a markdown genie runs as a prompt", () => {
  it("a .md genie reaches run_ai_prompt with its template filled from the selection", async () => {
    mountEditor();
    readGenie = () => Promise.resolve({ metadata: MARKDOWN_METADATA, template: "Improve: {{content}}" });

    await invokeFromMenu("/genies/improve.md");

    await vi.waitFor(() => expect(callsOf("run_ai_prompt")).toHaveLength(1));
    const [run] = callsOf("run_ai_prompt");
    expect(run.prompt).toBe("Improve: hello\n");
    expect(run.provider).toBe("openai");
    expect(callsOf("run_workflow")).toHaveLength(0);
    expect(useAiInvocationStore.getState().requestId).toBe(run.requestId);
    expect(useGeniesStore.getState().recentGenieNames).toEqual(["improve"]);
  });
});

describe("menu:invoke-genie — refusals", () => {
  it("a genie that cannot be read starts nothing and is not recorded as run", async () => {
    readGenie = () => Promise.reject(new Error("not found"));

    await invokeFromMenu("/genies/gone.md");
    await act(async () => {
      await Promise.resolve();
    });

    expect(callsOf("run_ai_prompt")).toHaveLength(0);
    expect(callsOf("run_workflow")).toHaveLength(0);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useGeniesStore.getState().recentGenieNames).toEqual([]);
  });

  it("a workflow genie with no workspace open tells the user and starts nothing", async () => {
    useWorkspaceStore.setState({ rootPath: null });

    await invokeFromMenu("/genies/review.yml");

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(callsOf("run_workflow")).toHaveLength(0);
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
  });
});

describe("genie menu lifecycle at the boundary", () => {
  it("mount loads the genies and refreshes the native menu; unmount hides it", async () => {
    const { unmount } = renderHook(() => useGenieShortcuts());

    await vi.waitFor(() => expect(callsOf("refresh_genies_menu")).toHaveLength(1));
    expect(callsOf("load_genies")).toHaveLength(1);

    unmount();
    expect(callsOf("hide_genies_menu")).toHaveLength(1);
  });

  it("menu:reload-genies reloads from disk and refreshes the menu again", async () => {
    renderHook(() => useGenieShortcuts());
    await vi.waitFor(() => expect(callsOf("refresh_genies_menu")).toHaveLength(1));

    const reload = bridge.handlers.get("menu:reload-genies");
    if (!reload) throw new Error("menu:reload-genies listener was never registered");
    await act(async () => {
      await reload({ payload: null });
    });

    await vi.waitFor(() => expect(callsOf("refresh_genies_menu")).toHaveLength(2));
    expect(callsOf("load_genies")).toHaveLength(2);
  });
});

describe("menu:invoke-genie — only the window the menu was used in runs the genie", () => {
  it("a window ignores a click whose payload names another window", async () => {
    mountEditor();
    readGenie = () => Promise.resolve({ metadata: MARKDOWN_METADATA, template: "Improve: {{content}}" });
    renderHook(() => useGenieMenuInvocation(), { wrapper: inWindow("main") });

    await act(async () => {
      await invokeGenieHandler()({ payload: ["/genies/improve.md", "doc-2"] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(callsOf("read_genie")).toHaveLength(0);
    expect(callsOf("run_ai_prompt")).toHaveLength(0);
  });

  it("a secondary window runs a click that names it", async () => {
    setCurrentWindowLabel("doc-2");
    useTabStore.setState({ activeTabId: { "doc-2": TAB } });
    mountEditor();
    readGenie = () => Promise.resolve({ metadata: MARKDOWN_METADATA, template: "Improve: {{content}}" });
    renderHook(() => useGenieMenuInvocation(), { wrapper: inWindow("doc-2") });

    await act(async () => {
      await invokeGenieHandler()({ payload: ["/genies/improve.md", "doc-2"] });
    });

    await vi.waitFor(() => expect(callsOf("run_ai_prompt")).toHaveLength(1));
    expect(callsOf("read_genie")).toEqual([{ path: "/genies/improve.md" }]);
  });

  it("the main-window lifecycle hook no longer listens for menu clicks", () => {
    renderHook(() => useGenieShortcuts());
    expect(bridge.handlers.has("menu:invoke-genie")).toBe(false);
    expect(bridge.handlers.has("menu:reload-genies")).toBe(true);
  });
});
