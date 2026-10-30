// applyGenieResult — the terminal decision on a genie run's text, driven
// directly through `handleStreamDone` with a real editor and the real stores.
// The stream itself (and the three refusals reached through it) is covered in
// streamRunner.test.ts; this file pins what that one cannot reach without a
// stream: an auto-applied INSERT, markdown in the result becoming structure,
// a captured position that no longer exists, and a run that started with no
// bound editor (`docAtStart: null`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { invoke } from "@tauri-apps/api/core";
import { useAiInvocationStore, useAiSuggestionStore } from "@/stores/aiStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useEditorStore } from "@/stores/editorStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { GenieAction } from "@/types/aiGenies";
import { editorForTab, handleStreamDone } from "./applyGenieResult";
import type { ExtractionResult } from "./extraction";
import type { RunContext } from "./streamRunnerContext";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

const TAB = "tab-apply";
let editor: Editor | null = null;

function mountEditor(): Editor {
  editor = new Editor({ extensions: [StarterKit], content: "<p>hello world</p>" });
  useEditorStore.getState().setActiveWysiwygEditor(editor, TAB);
  return editor;
}

function context(action: GenieAction, extraction: ExtractionResult, docAtStart = editor?.state.doc ?? null): RunContext {
  const requestId = "req-1";
  useAiInvocationStore.setState({ requestId, isRunning: true });
  return { requestId, tabId: TAB, windowLabel: "main", extraction, action, listenerRef: { current: null }, docAtStart };
}

function suggestions() {
  return [...useAiSuggestionStore.getState().suggestions.values()];
}

function setAutoApprove(enabled: boolean) {
  const advanced = useSettingsStore.getState().advanced;
  useSettingsStore.getState().updateAdvancedSetting("mcpServer", { ...advanced.mcpServer, autoApproveEdits: enabled });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  useSettingsStore.getState().resetSettings();
  useDocumentStore.setState({ documents: {} });
  useAiSuggestionStore.setState({ suggestions: new Map(), focusedSuggestionId: null });
  useGeniePickerStore.getState().closePicker();
  useEditorStore.getState().clearActiveEditors();
  useTabStore.setState({ activeTabId: { main: TAB } });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("handleStreamDone — auto-approve", () => {
  it("an insert lands AFTER the captured range and leaves the source text in place", () => {
    const ed = mountEditor();
    setAutoApprove(true);

    handleStreamDone(context("insert", { text: "hello", from: 1, to: 6 }), " there");

    // The result is trimmed before it is written, so only "there" lands.
    expect(ed.getText()).toBe("hellothere world");
    expect(suggestions()).toHaveLength(0);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });

  it("markdown in the result becomes document structure, not literal asterisks", () => {
    const ed = mountEditor();
    setAutoApprove(true);

    handleStreamDone(context("replace", { text: "hello", from: 1, to: 6 }), "**Howdy**");

    expect(ed.getText()).toBe("Howdy world");
    expect(ed.getHTML()).toContain("<strong>Howdy</strong>");
  });

  it("a captured position past the end of the document is not written; the result is kept as a suggestion", () => {
    const ed = mountEditor();
    setAutoApprove(true);

    handleStreamDone(context("insert", { text: "x", from: 1, to: 500 }), "late");

    expect(ed.getText()).toBe("hello world");
    expect(suggestions()).toEqual([expect.objectContaining({ tabId: TAB, type: "insert", newContent: "late" })]);
  });

  it("a run that started with no bound editor still applies when the range is valid", () => {
    const ed = mountEditor();
    setAutoApprove(true);

    handleStreamDone(context("replace", { text: "hello", from: 1, to: 6 }, null), "Howdy");

    expect(ed.getText()).toBe("Howdy world");
  });
});

describe("handleStreamDone — preview (auto-approve off)", () => {
  it("never touches the editor: the result is previewed and filed as a suggestion", () => {
    const ed = mountEditor();

    handleStreamDone(context("replace", { text: "hello", from: 1, to: 6 }), "  Howdy  ");

    expect(ed.getText()).toBe("hello world");
    expect(useGeniePickerStore.getState().responseText).toBe("Howdy");
    expect(suggestions()).toEqual([
      expect.objectContaining({ tabId: TAB, type: "replace", from: 1, to: 6, originalContent: "hello", newContent: "Howdy" }),
    ]);
  });
});

describe("editorForTab", () => {
  it("returns the editor bound to the tab and null for any other tab", () => {
    const ed = mountEditor();
    expect(editorForTab(TAB)).toBe(ed);
    expect(editorForTab("tab-other")).toBeNull();
  });
});
