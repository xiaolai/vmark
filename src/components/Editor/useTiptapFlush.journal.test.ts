// WI-AL1.4 — The flush reports each write to the agent edit journal's WYSIWYG collector before the store write, with the exact text and serializer options it wrote, and reports nothing when it writes nothing (the initial load has not run, or the document was refused).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Editor as TiptapEditor } from "@tiptap/core";

const order: string[] = [];
vi.mock("@/utils/markdownPipeline", () => ({ serializeMarkdown: vi.fn(() => "SERIALIZED") }));
vi.mock("@/services/agentJournal/collectors/wysiwyg/wysiwygCollector", () => ({
  noteWysiwygFlush: vi.fn(() => order.push("journal")),
}));

import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { noteWysiwygFlush } from "@/services/agentJournal/collectors/wysiwyg/wysiwygCollector";
import { markContentApplied } from "@/services/editor/contentApplied";
import { useTiptapFlush } from "./useTiptapFlush";

const editorStub = () => ({ schema: {}, state: { doc: { content: { size: 10 } } } }) as unknown as TiptapEditor;

function setup() {
  const setContent = vi.fn(() => order.push("store"));
  const { result } = renderHook(() =>
    useTiptapFlush({
      activeTabId: "tab-1",
      windowLabel: "main",
      setContent,
      preserveLineBreaksRef: { current: true },
      hardBreakStyleOnSaveRef: { current: "preserve" },
    }),
  );
  return { flush: result.current.flushToStore, setContent };
}

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  useSettingsStore.setState({ markdown: { ...useSettingsStore.getState().markdown, preserveBlankLines: true } });
  useTabStore.setState({ activeTabId: { main: "tab-1" } });
  useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
});

describe("flushToStore and the agent edit journal", () => {
  it("reports the written text and its options before the store write", () => {
    const editor = editorStub();
    markContentApplied(editor);
    const { flush } = setup();
    flush(editor);
    expect(order).toEqual(["journal", "store"]);
    expect(noteWysiwygFlush).toHaveBeenCalledWith(editor, "SERIALIZED", {
      preserveLineBreaks: true,
      preserveBlankLines: true,
      hardBreakStyle: expect.any(String),
    });
  });

  it("reports nothing before the initial load", () => {
    const { flush, setContent } = setup();
    flush(editorStub());
    expect(setContent).not.toHaveBeenCalled();
    expect(noteWysiwygFlush).not.toHaveBeenCalled();
  });

  it("reports nothing for a refused document", () => {
    const editor = editorStub();
    markContentApplied(editor);
    useLargeFileSessionStore.getState().markForcedSource("tab-1", "unparseable");
    const { flush } = setup();
    flush(editor);
    expect(noteWysiwygFlush).not.toHaveBeenCalled();
  });
});
